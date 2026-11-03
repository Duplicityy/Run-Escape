import { ByteBuffer } from "../../io/ByteBuffer";
import { StringUtil } from "../../util/StringUtil";
import { ArchiveReference } from "./ArchiveReference";

// What's known of an index's groups (archives) and their files. Kept in flat
// arrays rather than an object per group: the cache has about 150,000 groups,
// and the main thread and every worker keep their own copy. Group checksums
// (whirlpool) aren't kept, as nothing reads them.
export class ReferenceTable {
    static INVALID_TABLE = new ReferenceTable(
        -1,
        -1,
        false,
        false,
        new Int32Array(),
        new Int32Array(),
        new Int32Array(),
        new Int32Array(),
        new Int32Array(1),
        new Int32Array(),
        undefined,
    );

    // An old (dat) cache's index lists no files
    static fromArchiveCount(archiveCount: number): ReferenceTable {
        const archiveIds = new Int32Array(archiveCount);
        for (let i = 0; i < archiveCount; i++) {
            archiveIds[i] = i;
        }
        return new ReferenceTable(
            -1,
            -1,
            false,
            false,
            archiveIds,
            new Int32Array(archiveCount),
            new Int32Array(archiveCount),
            new Int32Array(archiveCount),
            undefined,
            new Int32Array(),
            undefined,
        );
    }

    static decode(buffer: ByteBuffer): ReferenceTable {
        const protocol = buffer.readUnsignedByte();
        if (protocol < 5 || protocol > 7) {
            throw new Error("Invalid protocol: " + protocol);
        }
        const revision = protocol > 5 ? buffer.readInt() : 0;
        const flag = buffer.readUnsignedByte();
        const hasNames = (flag & 0x1) !== 0;
        const hasWhirlpool = (flag & 0x2) !== 0;
        const hasSizes = (flag & 0x4) !== 0;
        const readCount = (): number =>
            protocol === 7 ? buffer.readBigSmart() : buffer.readUnsignedShort();
        const archiveCount = readCount();

        let lastArchiveId = 0;
        const archiveIds = new Int32Array(archiveCount);
        for (let i = 0; i < archiveCount; i++) {
            lastArchiveId += readCount();
            archiveIds[i] = lastArchiveId;
        }

        const archiveNameHashes = new Int32Array(archiveCount);
        if (hasNames) {
            for (let i = 0; i < archiveCount; i++) {
                archiveNameHashes[i] = buffer.readInt();
            }
        }

        if (hasWhirlpool) {
            buffer.offset += archiveCount * 64;
        }

        const archiveCrcs = new Int32Array(archiveCount);
        for (let i = 0; i < archiveCount; i++) {
            archiveCrcs[i] = buffer.readInt();
        }

        if (hasSizes) {
            buffer.offset += archiveCount * 8;
        }

        const archiveRevisions = new Int32Array(archiveCount);
        for (let i = 0; i < archiveCount; i++) {
            archiveRevisions[i] = buffer.readInt();
        }

        // Each group's files are fileIds[fileOffsets[i]] to fileIds[fileOffsets[i + 1]]
        const fileOffsets = new Int32Array(archiveCount + 1);
        for (let i = 0; i < archiveCount; i++) {
            fileOffsets[i + 1] = fileOffsets[i] + readCount();
        }

        const fileIds = new Int32Array(fileOffsets[archiveCount]);
        for (let archiveIdx = 0; archiveIdx < archiveCount; archiveIdx++) {
            let lastFileId = 0;
            for (let i = fileOffsets[archiveIdx]; i < fileOffsets[archiveIdx + 1]; i++) {
                lastFileId += readCount();
                fileIds[i] = lastFileId;
            }
        }

        let fileNameHashes: Int32Array | undefined;
        if (hasNames) {
            fileNameHashes = new Int32Array(fileIds.length);
            for (let i = 0; i < fileNameHashes.length; i++) {
                fileNameHashes[i] = buffer.readInt();
            }
        }

        return new ReferenceTable(
            protocol,
            revision,
            hasNames,
            hasWhirlpool,
            archiveIds,
            archiveNameHashes,
            archiveCrcs,
            archiveRevisions,
            fileOffsets,
            fileIds,
            fileNameHashes,
        );
    }

    readonly archiveCount: number;
    readonly lastArchiveId: number;

    // Group id to its index here, when the ids are packed close enough for a
    // table; otherwise a binary search (the ids are in order)
    private readonly idToIndex?: Int32Array;
    // Group name hash to group id, made the first time a group's asked for by name
    private nameHashToId?: Map<number, number>;

    constructor(
        readonly protocol: number,
        readonly revision: number,
        readonly named: boolean,
        readonly usesWhirlpool: boolean,
        readonly archiveIds: Int32Array,
        private readonly archiveNameHashes: Int32Array,
        private readonly archiveCrcs: Int32Array,
        private readonly archiveRevisions: Int32Array,
        // Unset when the files aren't listed (fromArchiveCount)
        private readonly fileOffsets: Int32Array | undefined,
        private readonly fileIds: Int32Array,
        private readonly fileNameHashes: Int32Array | undefined,
    ) {
        this.archiveCount = archiveIds.length;
        this.lastArchiveId = this.archiveCount > 0 ? archiveIds[this.archiveCount - 1] : -1;
        if (this.archiveCount > 0 && this.lastArchiveId < Math.max(this.archiveCount * 4, 1024)) {
            this.idToIndex = new Int32Array(this.lastArchiveId + 1).fill(-1);
            for (let i = 0; i < this.archiveCount; i++) {
                this.idToIndex[archiveIds[i]] = i;
            }
        }
    }

    private indexOf(id: number): number {
        if (this.idToIndex) {
            return id >= 0 && id < this.idToIndex.length ? this.idToIndex[id] : -1;
        }
        const ids = this.archiveIds;
        let low = 0;
        let high = ids.length - 1;
        while (low <= high) {
            const mid = (low + high) >>> 1;
            const value = ids[mid];
            if (value < id) {
                low = mid + 1;
            } else if (value > id) {
                high = mid - 1;
            } else {
                return mid;
            }
        }
        return -1;
    }

    getArchiveId(name: string): number | undefined {
        if (!this.named) {
            return undefined;
        }
        if (!this.nameHashToId) {
            this.nameHashToId = new Map();
            for (let i = 0; i < this.archiveCount; i++) {
                this.nameHashToId.set(this.archiveNameHashes[i], this.archiveIds[i]);
            }
        }
        return this.nameHashToId.get(StringUtil.hashDjb2(name));
    }

    archiveExists(id: number): boolean {
        return this.indexOf(id) !== -1;
    }

    // The number of files in a group, 0 if there's no such group (and -1 when
    // the files aren't listed)
    getFileCount(id: number): number {
        const i = this.indexOf(id);
        if (i === -1) {
            return 0;
        }
        return this.fileOffsets ? this.fileOffsets[i + 1] - this.fileOffsets[i] : -1;
    }

    getArchiveReference(id: number): ArchiveReference | undefined {
        const i = this.indexOf(id);
        if (i === -1) {
            return undefined;
        }
        const offsets = this.fileOffsets;
        if (!offsets) {
            return new ArchiveReference(
                id,
                this.archiveNameHashes[i],
                this.archiveCrcs[i],
                this.archiveRevisions[i],
                -1,
                0,
                undefined as unknown as Int32Array,
                undefined as unknown as Int32Array,
            );
        }
        const start = offsets[i];
        const end = offsets[i + 1];
        const fileIds = this.fileIds.subarray(start, end);
        return new ArchiveReference(
            id,
            this.archiveNameHashes[i],
            this.archiveCrcs[i],
            this.archiveRevisions[i],
            end - start,
            end > start ? fileIds[fileIds.length - 1] : 0,
            fileIds,
            // Unnamed, it's undefined, as it always was
            this.fileNameHashes?.subarray(start, end) as Int32Array,
        );
    }

    get archiveReferences(): ArchiveReference[] {
        const refs = new Array<ArchiveReference>(this.archiveIds.length);
        for (let i = 0; i < this.archiveIds.length; i++) {
            const ref = this.getArchiveReference(this.archiveIds[i]);
            if (ref) {
                refs[i] = ref;
            }
        }
        return refs;
    }
}

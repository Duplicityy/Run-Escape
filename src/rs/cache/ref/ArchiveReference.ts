import { ArchiveFileReference } from "./ArchiveFileReference";

export class ArchiveReference {
    // File id to its index, made the first time a file's looked up
    private fileIdIndexMap?: Map<number, number>;

    constructor(
        readonly id: number,
        readonly nameHash: number,
        readonly crc: number,
        readonly revision: number,
        readonly fileCount: number,
        readonly lastFileId: number,
        readonly fileIds: Int32Array,
        readonly fileNameHashes: Int32Array,
    ) {}

    getFileReference(id: number): ArchiveFileReference | undefined {
        if (!this.fileIdIndexMap) {
            this.fileIdIndexMap = new Map();
            for (let i = 0; i < this.fileCount; i++) {
                this.fileIdIndexMap.set(this.fileIds[i], i);
            }
        }
        const i = this.fileIdIndexMap.get(id);
        if (i === undefined) {
            return undefined;
        }

        return new ArchiveFileReference(
            this.fileIds[i],
            id,
            this.fileNameHashes ? this.fileNameHashes[i] : 0,
        );
    }

    get fileReferences(): ArchiveFileReference[] {
        const refs = new Array<ArchiveFileReference>(this.fileIds.length);
        for (let i = 0; i < this.fileIds.length; i++) {
            const ref = this.getFileReference(this.fileIds[i]);
            if (ref) {
                refs[i] = ref;
            }
        }
        return refs;
    }
}

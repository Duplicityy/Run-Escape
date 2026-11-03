import { Bzip2 } from "../compression/Bzip2";
import { Gzip } from "../compression/Gzip";
import { ByteBuffer } from "../io/ByteBuffer";
import { StringUtil } from "../util/StringUtil";
import { ArchiveFile } from "./ArchiveFile";

type HashFunction = (str: string) => number;

// Files kept in one array: file i is data[offsets[i]] to data[offsets[i + 1]]
type ArchiveData = {
    data: Int8Array;
    offsets: Int32Array;
};

export class Archive {
    static create(id: number, data: Int8Array): Archive {
        const fileCount = 1;
        const lastFileId = fileCount - 1;

        const fileIds = new Int32Array(fileCount);
        const fileNameHashes = new Int32Array(fileCount);

        return new Archive(StringUtil.hashOld, id, lastFileId, fileCount, fileIds, fileNameHashes, [
            data,
        ]);
    }

    static decodeOld(id: number, data: Int8Array, multipleFiles: boolean) {
        const buffer = new ByteBuffer(data);
        const files: Int8Array[] = [];

        let fileCount: number;
        let fileIds: Int32Array;
        let fileNameHashes: Int32Array;
        if (multipleFiles) {
            const actualSize = buffer.readMedium();
            const size = buffer.readMedium();

            const isCompressed = actualSize !== size;

            let dataBuffer: ByteBuffer;
            let metaBuffer: ByteBuffer;
            if (isCompressed) {
                const data = buffer.readUnsignedBytes(size);
                const decompressed = Bzip2.decompress(data, actualSize);
                dataBuffer = new ByteBuffer(decompressed);
                metaBuffer = new ByteBuffer(decompressed);
            } else {
                dataBuffer = new ByteBuffer(data);
                metaBuffer = buffer;
            }

            fileCount = metaBuffer.readUnsignedShort();
            dataBuffer.offset = metaBuffer.offset + fileCount * 10;

            fileIds = new Int32Array(fileCount);
            fileNameHashes = new Int32Array(fileCount);
            for (let i = 0; i < fileCount; i++) {
                const nameHash = metaBuffer.readInt();
                const fileActualSize = metaBuffer.readMedium();
                const fileSize = metaBuffer.readMedium();

                let decompressedFile: Int8Array;
                if (isCompressed) {
                    decompressedFile = dataBuffer.readBytes(fileSize);
                } else {
                    const data = dataBuffer.readUnsignedBytes(fileSize);
                    decompressedFile = Bzip2.decompress(data, fileActualSize);
                }
                files.push(decompressedFile);
                fileIds[i] = i;
                fileNameHashes[i] = nameHash;
            }
        } else {
            const decompressed = Gzip.decompress(buffer.readUnsignedBytes(buffer.remaining));

            fileCount = 1;
            fileIds = new Int32Array(fileCount);
            fileNameHashes = new Int32Array(fileCount);
            files.push(decompressed);
        }

        const lastFileId = fileCount - 1;

        return new Archive(
            StringUtil.hashOld,
            id,
            lastFileId,
            fileCount,
            fileIds,
            fileNameHashes,
            files,
        );
    }

    static decode(
        id: number,
        lastFileId: number,
        fileCount: number,
        fileIds: Int32Array,
        fileNameHashes: Int32Array,
        buffer: ByteBuffer,
    ): Archive {
        let files: Int8Array[] | ArchiveData;
        if (fileCount === 1) {
            files = [buffer.data];
        } else {
            buffer.offset = buffer.length - 1;
            const chunks = buffer.readUnsignedByte();

            buffer.offset = buffer.length - 1 - chunks * (fileCount * 4);

            const chunkSizes = new Int32Array(chunks * fileCount);
            const fileSizes = new Int32Array(fileCount);
            for (let chunk = 0; chunk < chunks; chunk++) {
                let lastFileSize = 0;
                for (let fileIdx = 0; fileIdx < fileCount; fileIdx++) {
                    lastFileSize += buffer.readInt();
                    chunkSizes[chunk * fileCount + fileIdx] = lastFileSize;
                    fileSizes[fileIdx] += lastFileSize;
                }
            }

            // The files one after the other in one array, rather than an array
            // each: a config group has thousands of them
            const offsets = new Int32Array(fileCount + 1);
            for (let fileIdx = 0; fileIdx < fileCount; fileIdx++) {
                offsets[fileIdx + 1] = offsets[fileIdx] + fileSizes[fileIdx];
            }
            const total = offsets[fileCount];
            let data: Int8Array;
            if (chunks === 1) {
                // Already in that order
                data = buffer.data.subarray(0, total);
            } else {
                data = new Int8Array(total);
                const written = offsets.slice(0, fileCount);
                buffer.offset = 0;
                for (let chunk = 0; chunk < chunks; chunk++) {
                    for (let fileIdx = 0; fileIdx < fileCount; fileIdx++) {
                        const chunkSize = chunkSizes[chunk * fileCount + fileIdx];
                        data.set(buffer.readBytes(chunkSize), written[fileIdx]);
                        written[fileIdx] += chunkSize;
                    }
                }
            }
            files = { data, offsets };
        }
        return new Archive(
            StringUtil.hashDjb2,
            id,
            lastFileId,
            fileCount,
            fileIds,
            fileNameHashes,
            files,
        );
    }

    // Whether file i's id is i, for all of them
    private readonly denseIds: boolean;
    // File name hash to file id, made the first time a file's asked for by name
    private fileNameHashIdMap?: Map<number, number>;

    constructor(
        private readonly _hashFunction: HashFunction,
        readonly id: number,
        readonly lastFileId: number,
        readonly fileCount: number,
        readonly fileIds: Int32Array,
        readonly fileNameHashes: Int32Array,
        // Each file's data, in the order of fileIds
        private readonly fileData: Int8Array[] | ArchiveData,
    ) {
        let dense = true;
        for (let i = 0; i < fileIds.length && dense; i++) {
            dense = fileIds[i] === i;
        }
        this.denseIds = dense;
    }

    private indexOf(id: number): number {
        const count = Array.isArray(this.fileData)
            ? this.fileData.length
            : this.fileData.offsets.length - 1;
        if (count === 1) {
            // A group of one file can be listed under its id alone
            return id === this.lastFileId || id === this.fileIds[0] ? 0 : -1;
        }
        if (this.denseIds) {
            return id >= 0 && id < count ? id : -1;
        }
        const ids = this.fileIds;
        let low = 0;
        let high = count - 1;
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

    private getData(i: number): Int8Array {
        const files = this.fileData;
        if (Array.isArray(files)) {
            return files[i];
        }
        return files.data.subarray(files.offsets[i], files.offsets[i + 1]);
    }

    getFile(id: number): ArchiveFile | undefined {
        const i = this.indexOf(id);
        if (i === -1) {
            return undefined;
        }
        return new ArchiveFile(id, this.id, this.getData(i));
    }

    getFileId(name: string): number {
        if (!this.fileNameHashIdMap) {
            this.fileNameHashIdMap = new Map();
            if (this.fileNameHashes) {
                for (let i = 0; i < this.fileIds.length; i++) {
                    this.fileNameHashIdMap.set(this.fileNameHashes[i], this.fileIds[i]);
                }
            }
        }
        const hash = this._hashFunction(name);

        return this.fileNameHashIdMap.get(hash) ?? -1;
    }

    getFileNamed(name: string): ArchiveFile | undefined {
        const id = this.getFileId(name);
        if (id === -1) {
            return undefined;
        }
        return this.getFile(id);
    }

    get files(): ArchiveFile[] {
        const count = Array.isArray(this.fileData)
            ? this.fileData.length
            : this.fileData.offsets.length - 1;
        const files = new Array<ArchiveFile>(count);
        for (let i = 0; i < count; i++) {
            files[i] = new ArchiveFile(
                this.fileIds[i] ?? this.lastFileId,
                this.id,
                this.getData(i),
            );
        }
        return files;
    }
}

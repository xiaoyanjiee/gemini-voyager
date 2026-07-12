import type { CloudWorkspaceV2 } from './schemas';

interface VersionedRecord {
  id: string;
  updatedAt: number;
  deletedAt: number | null;
}

function mergeRecords<T extends VersionedRecord>(local: T[], remote: T[]): T[] {
  const merged = new Map<string, T>();
  for (const record of [...local, ...remote]) {
    const existing = merged.get(record.id);
    if (
      !existing ||
      record.updatedAt > existing.updatedAt ||
      (record.updatedAt === existing.updatedAt &&
        record.deletedAt !== null &&
        existing.deletedAt === null)
    ) {
      merged.set(record.id, structuredClone(record));
    }
  }
  return [...merged.values()];
}

export function mergeCloudWorkspaces(
  local: CloudWorkspaceV2,
  remote: CloudWorkspaceV2,
): CloudWorkspaceV2 {
  return {
    schemaVersion: 2,
    revision: Math.max(local.revision, remote.revision) + 1,
    updatedAt: Math.max(Date.now(), local.updatedAt, remote.updatedAt),
    folders: mergeRecords(local.folders, remote.folders),
    prompts: mergeRecords(local.prompts, remote.prompts),
    starred: mergeRecords(local.starred, remote.starred),
  };
}

import { PrismaClient, createPrismaClient } from '../prisma';
import {
  VAULT_BACKUP_BLOB_TYPES,
  VAULT_BACKUP_HISTORY_DEFAULT_LIMIT,
  VAULT_BACKUP_HISTORY_MAX_LIMIT,
  VAULT_BACKUP_MAX_SIZE_BYTES,
  VaultBackupBlobType,
  VaultBackupEvent,
  VaultBackupSource,
  VaultBackupStatus,
  isVaultBackupBlobType,
  isVaultBackupEvent,
  isVaultBackupSource,
  isVaultBackupStatus,
} from './vaultBackupConstants';

export interface VaultBackupRecordDto {
  id: string;
  userId: string;
  event: VaultBackupEvent;
  source: VaultBackupSource;
  status: VaultBackupStatus;
  errorCode: string | null;
  schemaVersion: number;
  blobTypes: VaultBackupBlobType[];
  sizeBytes: number;
  createdAt: string;
}

export interface RecordVaultBackupInput {
  event: unknown;
  source: unknown;
  status: unknown;
  errorCode?: unknown;
  schemaVersion: unknown;
  blobTypes: unknown;
  sizeBytes: unknown;
}

type ServiceResult<T> =
  | { ok: true; status: 200 | 201; body: T }
  | {
      ok: false;
      status: 404 | 422;
      body: { message: string; details?: unknown };
    };

const ERROR_CODE_MAX_LENGTH = 64;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateRecordInput(input: RecordVaultBackupInput):
  | {
      ok: true;
      value: Omit<VaultBackupRecordDto, 'id' | 'userId' | 'createdAt'>;
    }
  | { ok: false; field: string; message: string } {
  if (!isPlainObject(input)) {
    return { ok: false, field: 'body', message: 'Body must be an object' };
  }

  if (!isVaultBackupEvent(input.event)) {
    return { ok: false, field: 'event', message: 'Invalid event' };
  }
  if (!isVaultBackupSource(input.source)) {
    return { ok: false, field: 'source', message: 'Invalid source' };
  }
  if (!isVaultBackupStatus(input.status)) {
    return { ok: false, field: 'status', message: 'Invalid status' };
  }

  let errorCode: string | null = null;
  if (input.errorCode !== undefined && input.errorCode !== null) {
    if (
      typeof input.errorCode !== 'string' ||
      input.errorCode.length === 0 ||
      input.errorCode.length > ERROR_CODE_MAX_LENGTH
    ) {
      return {
        ok: false,
        field: 'errorCode',
        message: 'errorCode must be a non-empty string up to 64 chars',
      };
    }
    errorCode = input.errorCode;
  }

  if (input.status === 'failed' && errorCode === null) {
    return {
      ok: false,
      field: 'errorCode',
      message: 'errorCode is required when status is failed',
    };
  }

  if (
    typeof input.schemaVersion !== 'number' ||
    !Number.isInteger(input.schemaVersion) ||
    input.schemaVersion < 1
  ) {
    return {
      ok: false,
      field: 'schemaVersion',
      message: 'schemaVersion must be a positive integer',
    };
  }

  if (!Array.isArray(input.blobTypes)) {
    return {
      ok: false,
      field: 'blobTypes',
      message: 'blobTypes must be an array',
    };
  }
  const blobTypes: VaultBackupBlobType[] = [];
  for (const candidate of input.blobTypes) {
    if (!isVaultBackupBlobType(candidate)) {
      return {
        ok: false,
        field: 'blobTypes',
        message: `Unknown blob type: ${String(candidate)}`,
      };
    }
    if (!blobTypes.includes(candidate)) blobTypes.push(candidate);
  }

  if (
    typeof input.sizeBytes !== 'number' ||
    !Number.isInteger(input.sizeBytes) ||
    input.sizeBytes < 0 ||
    input.sizeBytes > VAULT_BACKUP_MAX_SIZE_BYTES
  ) {
    return {
      ok: false,
      field: 'sizeBytes',
      message: `sizeBytes must be a non-negative integer up to ${VAULT_BACKUP_MAX_SIZE_BYTES}`,
    };
  }

  return {
    ok: true,
    value: {
      event: input.event,
      source: input.source,
      status: input.status,
      errorCode,
      schemaVersion: input.schemaVersion,
      blobTypes,
      sizeBytes: input.sizeBytes,
    },
  };
}

function toDto(row: {
  id: string;
  userId: string;
  event: string;
  source: string;
  status: string;
  errorCode: string | null;
  schemaVersion: number;
  blobTypes: string[];
  sizeBytes: number;
  createdAt: Date;
}): VaultBackupRecordDto {
  return {
    id: row.id,
    userId: row.userId,
    event: row.event as VaultBackupEvent,
    source: row.source as VaultBackupSource,
    status: row.status as VaultBackupStatus,
    errorCode: row.errorCode,
    schemaVersion: row.schemaVersion,
    blobTypes: row.blobTypes.filter(isVaultBackupBlobType),
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
  };
}

export class VaultBackupService {
  constructor(private readonly prisma: PrismaClient = createPrismaClient()) {}

  async recordEvent(
    userId: string,
    input: RecordVaultBackupInput,
  ): Promise<ServiceResult<VaultBackupRecordDto>> {
    const validated = validateRecordInput(input);
    if (validated.ok === false) {
      return {
        ok: false,
        status: 422,
        body: {
          message: validated.message,
          details: { field: validated.field },
        },
      };
    }

    const row = await this.prisma.vaultBackupRecord.create({
      data: { userId, ...validated.value },
    });

    return { ok: true, status: 201, body: toDto(row) };
  }

  async getLatest(
    userId: string,
    status?: string,
    source?: string,
    event?: string,
  ): Promise<ServiceResult<VaultBackupRecordDto | null>> {
    if (status !== undefined && !isVaultBackupStatus(status)) {
      return {
        ok: false,
        status: 422,
        body: { message: 'Invalid status filter' },
      };
    }
    if (source !== undefined && !isVaultBackupSource(source)) {
      return {
        ok: false,
        status: 422,
        body: { message: 'Invalid source filter' },
      };
    }
    if (event !== undefined && !isVaultBackupEvent(event)) {
      return {
        ok: false,
        status: 422,
        body: { message: 'Invalid event filter' },
      };
    }

    const row = await this.prisma.vaultBackupRecord.findFirst({
      where: {
        userId,
        ...(status ? { status } : {}),
        ...(source ? { source } : {}),
        ...(event ? { event } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!row) {
      return { ok: true, status: 200, body: null };
    }

    return { ok: true, status: 200, body: toDto(row) };
  }

  async listHistory(
    userId: string,
    options: { cursor?: string; limit?: number; source?: string } = {},
  ): Promise<
    ServiceResult<{ items: VaultBackupRecordDto[]; nextCursor: string | null }>
  > {
    const limitRaw = options.limit ?? VAULT_BACKUP_HISTORY_DEFAULT_LIMIT;
    if (
      !Number.isInteger(limitRaw) ||
      limitRaw < 1 ||
      limitRaw > VAULT_BACKUP_HISTORY_MAX_LIMIT
    ) {
      return {
        ok: false,
        status: 422,
        body: {
          message: `limit must be between 1 and ${VAULT_BACKUP_HISTORY_MAX_LIMIT}`,
        },
      };
    }
    if (options.source !== undefined && !isVaultBackupSource(options.source)) {
      return {
        ok: false,
        status: 422,
        body: { message: 'Invalid source filter' },
      };
    }

    const rows = await this.prisma.vaultBackupRecord.findMany({
      where: { userId, ...(options.source ? { source: options.source } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limitRaw + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limitRaw;
    const page = hasMore ? rows.slice(0, limitRaw) : rows;

    return {
      ok: true,
      status: 200,
      body: {
        items: page.map(toDto),
        nextCursor: hasMore ? page[page.length - 1].id : null,
      },
    };
  }
}

const vaultBackupService = new VaultBackupService();
export default vaultBackupService;

export { VAULT_BACKUP_BLOB_TYPES };

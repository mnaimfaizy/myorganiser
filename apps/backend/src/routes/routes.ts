/* tslint:disable */
/* eslint-disable */
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import type { TsoaRoute } from '@tsoa/runtime';
import {  fetchMiddlewares, ExpressTemplateService } from '@tsoa/runtime';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { YouTubeController } from './../controllers/YouTubeController';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { VaultController } from './../controllers/VaultController';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { VaultBackupController } from './../controllers/VaultBackupController';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { UserDeletionController } from './../controllers/UserDeletionController';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { FeedbackReleaseController } from './../controllers/FeedbackReleaseController';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { FeedbackPublicController } from './../controllers/FeedbackPublicController';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { FeedbackController } from './../controllers/FeedbackController';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { AuthController } from './../controllers/AuthController';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { AdminYouTubeAccessController } from './../controllers/AdminYouTubeAccessController';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { AdminUsersController } from './../controllers/AdminUsersController';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { AdminFeedbackController } from './../controllers/AdminFeedbackController';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { AdminAuditLogController } from './../controllers/AdminAuditLogController';
import { expressAuthentication } from './../middleware/authentication';
// @ts-ignore - no great way to install types from subpackage
import type { Request as ExRequest, Response as ExResponse, RequestHandler, Router } from 'express';

const expressAuthenticationRecasted = expressAuthentication as (req: ExRequest, securityName: string, scopes?: string[], res?: ExResponse) => Promise<any>;


// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

const models: TsoaRoute.Models = {
    "VersionFloorRefusal": {
        "dataType": "refObject",
        "properties": {
            "code": {"dataType":"enum","enums":["below_version_floor"],"required":true},
            "message": {"dataType":"string","required":true},
            "versionFloor": {"dataType":"string","required":true},
            "platform": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["android"]},{"dataType":"enum","enums":["ios"]},{"dataType":"enum","enums":[null]}],"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "YouTubeAcknowledgementResponse": {
        "dataType": "refObject",
        "properties": {
            "acknowledgedAt": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "YouTubeErrorResponse": {
        "dataType": "refAlias",
        "type": {"dataType":"nestedObjectLiteral","nestedProperties":{"message":{"dataType":"string","required":true}},"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "AuthUrlResponse": {
        "dataType": "refObject",
        "properties": {
            "url": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "AcknowledgementRequiredResponse": {
        "dataType": "refObject",
        "properties": {
            "message": {"dataType":"string","required":true},
            "code": {"dataType":"enum","enums":["acknowledgement_required"],"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "StatusResponse": {
        "dataType": "refObject",
        "properties": {
            "connected": {"dataType":"boolean","required":true},
            "status": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "DisconnectResponse": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"nestedObjectLiteral","nestedProperties":{"googlePermissionsUrl":{"dataType":"string"},"revokeFailed":{"dataType":"boolean"},"message":{"dataType":"string","required":true},"ok":{"dataType":"enum","enums":[true],"required":true}}},{"dataType":"nestedObjectLiteral","nestedProperties":{"code":{"dataType":"enum","enums":["sync_run_live"]},"message":{"dataType":"string","required":true},"ok":{"dataType":"enum","enums":[false],"required":true}}}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "SubscriptionResponse": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "channelId": {"dataType":"string","required":true},
            "channelTitle": {"dataType":"string","required":true},
            "channelThumbnail": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "uploadsPlaylistId": {"dataType":"string","required":true},
            "enabled": {"dataType":"boolean","required":true},
            "lastSyncedAt": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ChannelSyncResponse": {
        "dataType": "refObject",
        "properties": {
            "synced": {"dataType":"double","required":true},
            "status": {"dataType":"string","required":true},
            "lastAttemptAt": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "lastError": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "retryAt": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ProgressResponse": {
        "dataType": "refObject",
        "properties": {
            "total": {"dataType":"double","required":true},
            "processed": {"dataType":"double","required":true},
            "succeeded": {"dataType":"double","required":true},
            "failed": {"dataType":"double","required":true},
            "startedAt": {"dataType":"string","required":true},
            "failedChannels": {"dataType":"array","array":{"dataType":"nestedObjectLiteral","nestedProperties":{"error":{"dataType":"string","required":true},"channelTitle":{"dataType":"string","required":true},"channelId":{"dataType":"string","required":true}}},"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "SyncResponse": {
        "dataType": "refObject",
        "properties": {
            "status": {"dataType":"string","required":true},
            "lastSyncedAt": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "lastSyncAttemptAt": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "lastSyncError": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "retryAt": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "progress": {"dataType":"union","subSchemas":[{"ref":"ProgressResponse"},{"dataType":"enum","enums":[null]}],"required":true},
            "channelStatus": {"dataType":"string","required":true},
            "channelLastAttemptAt": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "channelLastError": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "channelRetryAt": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "synced": {"dataType":"double","required":true},
            "videosSynced": {"dataType":"double","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "SyncStatusResponse": {
        "dataType": "refObject",
        "properties": {
            "status": {"dataType":"string","required":true},
            "lastSyncedAt": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "lastSyncAttemptAt": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "lastSyncError": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "retryAt": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "progress": {"dataType":"union","subSchemas":[{"ref":"ProgressResponse"},{"dataType":"enum","enums":[null]}],"required":true},
            "channelStatus": {"dataType":"string","required":true},
            "channelLastAttemptAt": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "channelLastError": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "channelRetryAt": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "VideoResponse": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "videoId": {"dataType":"string","required":true},
            "channelId": {"dataType":"string","required":true},
            "title": {"dataType":"string","required":true},
            "thumbnail": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "publishedAt": {"dataType":"string","required":true},
            "watched": {"dataType":"boolean","required":true},
            "channelTitle": {"dataType":"string"},
            "durationSeconds": {"dataType":"union","subSchemas":[{"dataType":"double"},{"dataType":"enum","enums":[null]}],"required":true},
            "isShort": {"dataType":"boolean","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "VideosPageResponse": {
        "dataType": "refObject",
        "properties": {
            "videos": {"dataType":"array","array":{"dataType":"refObject","ref":"VideoResponse"},"required":true},
            "total": {"dataType":"double","required":true},
            "page": {"dataType":"double","required":true},
            "limit": {"dataType":"double","required":true},
            "totalPages": {"dataType":"double","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "WatchedResponse": {
        "dataType": "refObject",
        "properties": {
            "ok": {"dataType":"boolean","required":true},
            "watched": {"dataType":"boolean","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "WatchedBody": {
        "dataType": "refObject",
        "properties": {
            "watched": {"dataType":"boolean","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ChannelCarouselResponse": {
        "dataType": "refObject",
        "properties": {
            "channelId": {"dataType":"string","required":true},
            "channelTitle": {"dataType":"string","required":true},
            "channelThumbnail": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "videos": {"dataType":"array","array":{"dataType":"refObject","ref":"VideoResponse"},"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "NotificationSettingsResponse": {
        "dataType": "refObject",
        "properties": {
            "enabled": {"dataType":"boolean","required":true},
            "lastNotifiedAt": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "preferredWeekday": {"dataType":"double","required":true},
            "timeZone": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "NotificationSettingsBody": {
        "dataType": "refObject",
        "properties": {
            "enabled": {"dataType":"boolean"},
            "preferredWeekday": {"dataType":"double"},
            "timeZone": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "YouTubeAccessResponse": {
        "dataType": "refObject",
        "properties": {
            "granted": {"dataType":"boolean","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "YouTubeAvailabilityResponse": {
        "dataType": "refObject",
        "properties": {
            "available": {"dataType":"boolean","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "UnsubscribeResponse": {
        "dataType": "refObject",
        "properties": {
            "ok": {"dataType":"boolean","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "UnsubscribeBody": {
        "dataType": "refObject",
        "properties": {
            "token": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "CronSyncResponse": {
        "dataType": "refObject",
        "properties": {
            "ran": {"dataType":"boolean","required":true},
            "processed": {"dataType":"double","required":true},
            "usersSynced": {"dataType":"double","required":true},
            "failed": {"dataType":"double","required":true},
            "done": {"dataType":"boolean","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "CronDigestResponse": {
        "dataType": "refObject",
        "properties": {
            "ran": {"dataType":"boolean","required":true},
            "processed": {"dataType":"double","required":true},
            "sent": {"dataType":"double","required":true},
            "skippedEmpty": {"dataType":"double","required":true},
            "notDue": {"dataType":"double","required":true},
            "duplicates": {"dataType":"double","required":true},
            "failed": {"dataType":"double","required":true},
            "done": {"dataType":"boolean","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "Record_string.unknown_": {
        "dataType": "refAlias",
        "type": {"dataType":"nestedObjectLiteral","nestedProperties":{},"additionalProperties":{"dataType":"any"},"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "VaultMetaV1": {
        "dataType": "refObject",
        "properties": {
            "version": {"dataType":"double","required":true},
            "kdf_name": {"dataType":"string","required":true},
            "kdf_salt": {"dataType":"string","required":true},
            "kdf_params": {"ref":"Record_string.unknown_","required":true},
            "wrapped_mk_passphrase": {"dataType":"any","required":true},
            "wrapped_mk_recovery": {"dataType":"any","required":true},
        },
        "additionalProperties": {"dataType":"any"},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ErrorResponse": {
        "dataType": "refObject",
        "properties": {
            "message": {"dataType":"string","required":true},
            "details": {"dataType":"any"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "GetVaultMetaResponse": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"nestedObjectLiteral","nestedProperties":{"etag":{"dataType":"string","required":true},"updatedAt":{"dataType":"string","required":true},"meta":{"ref":"VaultMetaV1","required":true}}},{"ref":"ErrorResponse"}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PutVaultMetaResponse": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"nestedObjectLiteral","nestedProperties":{"updatedAt":{"dataType":"string","required":true},"etag":{"dataType":"string","required":true},"ok":{"dataType":"enum","enums":[true],"required":true}}},{"ref":"ErrorResponse"}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "VaultBlobType": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["addresses"]},{"dataType":"enum","enums":["groceries"]},{"dataType":"enum","enums":["mobileNumbers"]},{"dataType":"enum","enums":["subscriptions"]},{"dataType":"enum","enums":["tasks"]}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "EncryptedBlobV1": {
        "dataType": "refObject",
        "properties": {
            "version": {"dataType":"double","required":true},
            "iv": {"dataType":"string","required":true},
            "ciphertext": {"dataType":"string","required":true},
        },
        "additionalProperties": {"dataType":"any"},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "GetVaultBlobResponse": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"nestedObjectLiteral","nestedProperties":{"etag":{"dataType":"string","required":true},"updatedAt":{"dataType":"string","required":true},"blob":{"ref":"EncryptedBlobV1","required":true},"type":{"ref":"VaultBlobType","required":true}}},{"ref":"ErrorResponse"}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "GetVaultBlobInventoryResponse": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"nestedObjectLiteral","nestedProperties":{"etag":{"dataType":"string","required":true},"blobs":{"dataType":"array","array":{"dataType":"nestedObjectLiteral","nestedProperties":{"updatedAt":{"dataType":"string","required":true},"etag":{"dataType":"string","required":true},"type":{"ref":"VaultBlobType","required":true}}},"required":true}}},{"ref":"ErrorResponse"}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PutVaultBlobResponse": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"nestedObjectLiteral","nestedProperties":{"updatedAt":{"dataType":"string","required":true},"etag":{"dataType":"string","required":true},"ok":{"dataType":"enum","enums":[true],"required":true}}},{"ref":"ErrorResponse"}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "Partial_Record_VaultBlobType.EncryptedBlobV1__": {
        "dataType": "refAlias",
        "type": {"dataType":"nestedObjectLiteral","nestedProperties":{"addresses":{"ref":"EncryptedBlobV1"},"groceries":{"ref":"EncryptedBlobV1"},"mobileNumbers":{"ref":"EncryptedBlobV1"},"subscriptions":{"ref":"EncryptedBlobV1"},"tasks":{"ref":"EncryptedBlobV1"}},"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "VaultExportV1": {
        "dataType": "refObject",
        "properties": {
            "exportVersion": {"dataType":"enum","enums":[1],"required":true},
            "exportedAt": {"dataType":"string","required":true},
            "meta": {"ref":"VaultMetaV1","required":true},
            "blobs": {"ref":"Partial_Record_VaultBlobType.EncryptedBlobV1__","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ExportVaultResponse": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"ref":"VaultExportV1"},{"ref":"ErrorResponse"}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ImportVaultResponse": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"nestedObjectLiteral","nestedProperties":{"ok":{"dataType":"enum","enums":[true],"required":true}}},{"ref":"ErrorResponse"}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "VaultBackupEvent": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["export"]},{"dataType":"enum","enums":["import"]}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "VaultBackupSource": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["local-file"]},{"dataType":"enum","enums":["google-drive"]}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "VaultBackupStatus": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["success"]},{"dataType":"enum","enums":["failed"]}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "VaultBackupBlobType": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["addresses"]},{"dataType":"enum","enums":["groceries"]},{"dataType":"enum","enums":["mobileNumbers"]},{"dataType":"enum","enums":["subscriptions"]},{"dataType":"enum","enums":["tasks"]}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "VaultBackupRecordDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "userId": {"dataType":"string","required":true},
            "event": {"ref":"VaultBackupEvent","required":true},
            "source": {"ref":"VaultBackupSource","required":true},
            "status": {"ref":"VaultBackupStatus","required":true},
            "errorCode": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "schemaVersion": {"dataType":"double","required":true},
            "blobTypes": {"dataType":"array","array":{"dataType":"refAlias","ref":"VaultBackupBlobType"},"required":true},
            "sizeBytes": {"dataType":"double","required":true},
            "createdAt": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "RecordVaultBackupResponse": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"ref":"VaultBackupRecordDto"},{"ref":"ErrorResponse"}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "RecordVaultBackupRequest": {
        "dataType": "refObject",
        "properties": {
            "event": {"ref":"VaultBackupEvent","required":true},
            "source": {"ref":"VaultBackupSource","required":true},
            "status": {"ref":"VaultBackupStatus","required":true},
            "errorCode": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}]},
            "schemaVersion": {"dataType":"double","required":true},
            "blobTypes": {"dataType":"array","array":{"dataType":"refAlias","ref":"VaultBackupBlobType"},"required":true},
            "sizeBytes": {"dataType":"double","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "GetLatestVaultBackupResponse": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"ref":"VaultBackupRecordDto"},{"ref":"ErrorResponse"}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "VaultBackupHistoryPage": {
        "dataType": "refObject",
        "properties": {
            "items": {"dataType":"array","array":{"dataType":"refObject","ref":"VaultBackupRecordDto"},"required":true},
            "nextCursor": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ListVaultBackupsResponse": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"ref":"VaultBackupHistoryPage"},{"ref":"ErrorResponse"}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ValidateErrorJSON": {
        "dataType": "refObject",
        "properties": {
            "message": {"dataType":"enum","enums":["Validation failed"],"required":true},
            "details": {"dataType":"nestedObjectLiteral","nestedProperties":{},"additionalProperties":{"dataType":"any"},"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "UserDeletionRefusal": {
        "dataType": "refObject",
        "properties": {
            "message": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "UserDeletionBody": {
        "dataType": "refObject",
        "properties": {
            "password": {"dataType":"string","required":true},
            "confirmation": {"dataType":"enum","enums":["DELETE"],"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "FeedbackReleaseMarkCounts": {
        "dataType": "refObject",
        "properties": {
            "reportsMarked": {"dataType":"double","required":true},
            "fixNoticesSent": {"dataType":"double","required":true},
            "fixNoticesSkipped": {"dataType":"double","required":true},
            "fixNoticesFailed": {"dataType":"double","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "MarkFeedbackReleaseRequest": {
        "dataType": "refObject",
        "properties": {
            "releaseTag": {"dataType":"string","required":true},
            "issueNumbers": {"dataType":"array","array":{"dataType":"double"},"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "FixNoticeUnsubscribeResponse": {
        "dataType": "refObject",
        "properties": {
            "ok": {"dataType":"enum","enums":[true],"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "FixNoticeUnsubscribeBody": {
        "dataType": "refObject",
        "properties": {
            "token": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "FeedbackReportKind": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["bug_report"]},{"dataType":"enum","enums":["suggestion"]}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "FeedbackReportStatus": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["received"]},{"dataType":"enum","enums":["under_review"]},{"dataType":"enum","enums":["planned"]},{"dataType":"enum","enums":["fixed"]},{"dataType":"enum","enums":["shipped"]},{"dataType":"enum","enums":["wont_do"]},{"dataType":"enum","enums":["cannot_reproduce"]}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "FeedbackReportDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "kind": {"ref":"FeedbackReportKind","required":true},
            "status": {"ref":"FeedbackReportStatus","required":true},
            "title": {"dataType":"string","required":true},
            "createdAt": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "CreateFeedbackReportResponse": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"ref":"FeedbackReportDto"},{"ref":"ErrorResponse"}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ReportContextRequest": {
        "dataType": "refObject",
        "properties": {
            "platform": {"dataType":"string","required":true},
            "appVersion": {"dataType":"string","required":true},
            "browser": {"dataType":"string","required":true},
            "operatingSystem": {"dataType":"string","required":true},
            "path": {"dataType":"string","required":true},
            "sentAt": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "CreateFeedbackReportRequest": {
        "dataType": "refObject",
        "properties": {
            "kind": {"ref":"FeedbackReportKind","required":true},
            "title": {"dataType":"string","required":true},
            "description": {"dataType":"string","required":true},
            "expectedOutcome": {"dataType":"string"},
            "context": {"ref":"ReportContextRequest","required":true},
            "fixNoticeOptIn": {"dataType":"boolean","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "FeedbackReportListItemDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "kind": {"ref":"FeedbackReportKind","required":true},
            "status": {"ref":"FeedbackReportStatus","required":true},
            "title": {"dataType":"string","required":true},
            "statusNote": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "releaseTag": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "changelogUrl": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "statusChangedAt": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "createdAt": {"dataType":"string","required":true},
            "followUp": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ListFeedbackReportsResponse": {
        "dataType": "refObject",
        "properties": {
            "items": {"dataType":"array","array":{"dataType":"refObject","ref":"FeedbackReportListItemDto"},"required":true},
            "hasChangedSinceLastSeen": {"dataType":"boolean","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "MarkReportSeenResponse": {
        "dataType": "refObject",
        "properties": {
            "seenAt": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "AddFollowUpResponse": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"ref":"FeedbackReportListItemDto"},{"ref":"ErrorResponse"}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "AddFollowUpRequest": {
        "dataType": "refObject",
        "properties": {
            "followUp": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "UserRole": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["user"]},{"dataType":"enum","enums":["platform_admin"]}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "FilteredUserInterface": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "name": {"dataType":"string","required":true},
            "email": {"dataType":"string","required":true},
            "firstName": {"dataType":"string","required":true},
            "lastName": {"dataType":"string","required":true},
            "phone": {"dataType":"string"},
            "role": {"ref":"UserRole","required":true},
            "disabled": {"dataType":"boolean","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "UserLoginBody": {
        "dataType": "refObject",
        "properties": {
            "email": {"dataType":"string","required":true},
            "password": {"dataType":"string","required":true},
            "client_type": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["mobile"]},{"dataType":"enum","enums":["web"]}]},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "RefreshTokenBody": {
        "dataType": "refObject",
        "properties": {
            "refresh_token": {"dataType":"string"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "RegisterUserResponse": {
        "dataType": "refObject",
        "properties": {
            "message": {"dataType":"string","required":true},
            "user": {"ref":"FilteredUserInterface"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "UserCreationBody": {
        "dataType": "refObject",
        "properties": {
            "name": {"dataType":"string"},
            "firstName": {"dataType":"string","required":true},
            "lastName": {"dataType":"string","required":true},
            "phone": {"dataType":"string"},
            "email": {"dataType":"string","required":true},
            "password": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ResetPasswordByEmailBody": {
        "dataType": "refObject",
        "properties": {
            "email": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ConfirmResetPasswordBody": {
        "dataType": "refObject",
        "properties": {
            "token": {"dataType":"string","required":true},
            "password": {"dataType":"string","required":true},
            "confirm_password": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "YouTubeAccessUsageResponse": {
        "dataType": "refObject",
        "properties": {
            "everGranted": {"dataType":"double","required":true},
            "ceiling": {"dataType":"double","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "AdminUserIdentity": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "name": {"dataType":"string","required":true},
            "email": {"dataType":"string","required":true},
            "firstName": {"dataType":"string","required":true},
            "lastName": {"dataType":"string","required":true},
            "phone": {"dataType":"string"},
            "role": {"ref":"UserRole","required":true},
            "disabled": {"dataType":"boolean","required":true},
            "emailVerified": {"dataType":"boolean","required":true},
            "youtubeAccess": {"dataType":"boolean","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "YouTubeDisconnectOutcome": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["completed"]},{"dataType":"enum","enums":["pending"]},{"dataType":"enum","enums":["not_connected"]}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "WithdrawYouTubeAccessResponse": {
        "dataType": "refAlias",
        "type": {"dataType":"intersection","subSchemas":[{"ref":"AdminUserIdentity"},{"dataType":"nestedObjectLiteral","nestedProperties":{"youtubeDisconnect":{"ref":"YouTubeDisconnectOutcome","required":true}}}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "AdminFeedbackReporterDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "name": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "email": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "AdminFeedbackReportListItemDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "kind": {"ref":"FeedbackReportKind","required":true},
            "status": {"ref":"FeedbackReportStatus","required":true},
            "title": {"dataType":"string","required":true},
            "platform": {"dataType":"string","required":true},
            "trackingIssueNumber": {"dataType":"union","subSchemas":[{"dataType":"double"},{"dataType":"enum","enums":[null]}],"required":true},
            "reporterUserId": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "reporter": {"dataType":"union","subSchemas":[{"ref":"AdminFeedbackReporterDto"},{"dataType":"enum","enums":[null]}],"required":true},
            "statusChangedAt": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "createdAt": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ListAdminFeedbackReportsResponse": {
        "dataType": "refObject",
        "properties": {
            "items": {"dataType":"array","array":{"dataType":"refObject","ref":"AdminFeedbackReportListItemDto"},"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "AdminFeedbackReportContextDto": {
        "dataType": "refObject",
        "properties": {
            "platform": {"dataType":"string","required":true},
            "appVersion": {"dataType":"string","required":true},
            "browser": {"dataType":"string","required":true},
            "operatingSystem": {"dataType":"string","required":true},
            "path": {"dataType":"string","required":true},
            "sentAt": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "AdminFeedbackReportDetailDto": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "kind": {"ref":"FeedbackReportKind","required":true},
            "status": {"ref":"FeedbackReportStatus","required":true},
            "title": {"dataType":"string","required":true},
            "platform": {"dataType":"string","required":true},
            "trackingIssueNumber": {"dataType":"union","subSchemas":[{"dataType":"double"},{"dataType":"enum","enums":[null]}],"required":true},
            "reporterUserId": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "reporter": {"dataType":"union","subSchemas":[{"ref":"AdminFeedbackReporterDto"},{"dataType":"enum","enums":[null]}],"required":true},
            "statusChangedAt": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "createdAt": {"dataType":"string","required":true},
            "description": {"dataType":"string","required":true},
            "expectedOutcome": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "context": {"ref":"AdminFeedbackReportContextDto","required":true},
            "followUp": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "statusNote": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "releaseTag": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "fixNoticeOptIn": {"dataType":"boolean","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ChangeFeedbackReportStatusRequest": {
        "dataType": "refObject",
        "properties": {
            "status": {"ref":"FeedbackReportStatus","required":true},
            "statusNote": {"dataType":"string"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "LinkFeedbackReportTrackingIssueRequest": {
        "dataType": "refObject",
        "properties": {
            "trackingIssueNumber": {"dataType":"double","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "MarkFeedbackReportDeliveredRequest": {
        "dataType": "refObject",
        "properties": {
            "releaseTag": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "AdminAuditAction": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["disable"]},{"dataType":"enum","enums":["enable"]},{"dataType":"enum","enums":["force_logout"]},{"dataType":"enum","enums":["resend_verification"]},{"dataType":"enum","enums":["promote"]},{"dataType":"enum","enums":["demote"]},{"dataType":"enum","enums":["youtube_access_grant"]},{"dataType":"enum","enums":["youtube_access_withdraw"]},{"dataType":"enum","enums":["feedback_status_change"]},{"dataType":"enum","enums":["feedback_tracking_issue_link"]},{"dataType":"enum","enums":["feedback_tracking_issue_unlink"]},{"dataType":"enum","enums":["feedback_manual_delivery"]}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "AdminAuditLogEntry": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "actorUserId": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "targetUserId": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "action": {"ref":"AdminAuditAction","required":true},
            "createdAt": {"dataType":"datetime","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
};
const templateService = new ExpressTemplateService(models, {"noImplicitAdditionalProperties":"throw-on-extras","bodyCoercion":true});

// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa




export function RegisterRoutes(app: Router) {

    // ###########################################################################################################
    //  NOTE: If you do not see routes for all of your controllers in this file, then you might not have informed tsoa of where to look
    //      Please look into the "controllerPathGlobs" config option described in the readme: https://github.com/lukeautry/tsoa
    // ###########################################################################################################


    
        const argsYouTubeController_getAcknowledgement: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        app.get('/youtube/acknowledgement',
            authenticateMiddleware([{"jwt":["youtube_access"]}]),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController)),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController.prototype.getAcknowledgement)),

            async function YouTubeController_getAcknowledgement(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsYouTubeController_getAcknowledgement, request, response });

                const controller = new YouTubeController();

              await templateService.apiHandler({
                methodName: 'getAcknowledgement',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsYouTubeController_acceptAcknowledgement: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        app.post('/youtube/acknowledgement',
            authenticateMiddleware([{"jwt":["youtube_access"]}]),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController)),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController.prototype.acceptAcknowledgement)),

            async function YouTubeController_acceptAcknowledgement(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsYouTubeController_acceptAcknowledgement, request, response });

                const controller = new YouTubeController();

              await templateService.apiHandler({
                methodName: 'acceptAcknowledgement',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsYouTubeController_getAuthUrl: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        app.get('/youtube/auth-url',
            authenticateMiddleware([{"jwt":["youtube_access"]}]),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController)),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController.prototype.getAuthUrl)),

            async function YouTubeController_getAuthUrl(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsYouTubeController_getAuthUrl, request, response });

                const controller = new YouTubeController();

              await templateService.apiHandler({
                methodName: 'getAuthUrl',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsYouTubeController_handleCallback: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                body: {"in":"body","name":"body","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"code":{"dataType":"string","required":true}}},
        };
        app.post('/youtube/callback',
            authenticateMiddleware([{"jwt":["youtube_access"]}]),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController)),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController.prototype.handleCallback)),

            async function YouTubeController_handleCallback(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsYouTubeController_handleCallback, request, response });

                const controller = new YouTubeController();

              await templateService.apiHandler({
                methodName: 'handleCallback',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsYouTubeController_getConnectionStatus: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        app.get('/youtube/status',
            authenticateMiddleware([{"jwt":["youtube_access"]}]),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController)),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController.prototype.getConnectionStatus)),

            async function YouTubeController_getConnectionStatus(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsYouTubeController_getConnectionStatus, request, response });

                const controller = new YouTubeController();

              await templateService.apiHandler({
                methodName: 'getConnectionStatus',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsYouTubeController_disconnect: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        app.delete('/youtube/disconnect',
            authenticateMiddleware([{"jwt":["youtube_access"]}]),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController)),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController.prototype.disconnect)),

            async function YouTubeController_disconnect(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsYouTubeController_disconnect, request, response });

                const controller = new YouTubeController();

              await templateService.apiHandler({
                methodName: 'disconnect',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsYouTubeController_getSubscriptions: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        app.get('/youtube/subscriptions',
            authenticateMiddleware([{"jwt":["youtube_access"]}]),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController)),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController.prototype.getSubscriptions)),

            async function YouTubeController_getSubscriptions(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsYouTubeController_getSubscriptions, request, response });

                const controller = new YouTubeController();

              await templateService.apiHandler({
                methodName: 'getSubscriptions',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsYouTubeController_syncSubscriptions: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        app.put('/youtube/subscriptions/sync',
            authenticateMiddleware([{"jwt":["youtube_access"]}]),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController)),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController.prototype.syncSubscriptions)),

            async function YouTubeController_syncSubscriptions(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsYouTubeController_syncSubscriptions, request, response });

                const controller = new YouTubeController();

              await templateService.apiHandler({
                methodName: 'syncSubscriptions',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsYouTubeController_syncUploads: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        app.put('/youtube/uploads/sync',
            authenticateMiddleware([{"jwt":["youtube_access"]}]),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController)),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController.prototype.syncUploads)),

            async function YouTubeController_syncUploads(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsYouTubeController_syncUploads, request, response });

                const controller = new YouTubeController();

              await templateService.apiHandler({
                methodName: 'syncUploads',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsYouTubeController_getSyncStatus: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        app.get('/youtube/sync-status',
            authenticateMiddleware([{"jwt":["youtube_access"]}]),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController)),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController.prototype.getSyncStatus)),

            async function YouTubeController_getSyncStatus(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsYouTubeController_getSyncStatus, request, response });

                const controller = new YouTubeController();

              await templateService.apiHandler({
                methodName: 'getSyncStatus',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsYouTubeController_toggleSubscription: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                subscriptionId: {"in":"path","name":"subscriptionId","required":true,"dataType":"string"},
                body: {"in":"body","name":"body","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"enabled":{"dataType":"boolean","required":true}}},
        };
        app.patch('/youtube/subscriptions/:subscriptionId',
            authenticateMiddleware([{"jwt":["youtube_access"]}]),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController)),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController.prototype.toggleSubscription)),

            async function YouTubeController_toggleSubscription(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsYouTubeController_toggleSubscription, request, response });

                const controller = new YouTubeController();

              await templateService.apiHandler({
                methodName: 'toggleSubscription',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsYouTubeController_getVideos: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                sort: {"in":"query","name":"sort","dataType":"union","subSchemas":[{"dataType":"enum","enums":["latest"]},{"dataType":"enum","enums":["oldest"]},{"dataType":"enum","enums":["az"]}]},
                search: {"in":"query","name":"search","dataType":"string"},
                page: {"in":"query","name":"page","dataType":"double"},
                limit: {"in":"query","name":"limit","dataType":"double"},
                channelId: {"in":"query","name":"channelId","dataType":"string"},
                kind: {"in":"query","name":"kind","dataType":"union","subSchemas":[{"dataType":"enum","enums":["short"]},{"dataType":"enum","enums":["long"]},{"dataType":"enum","enums":["all"]}]},
        };
        app.get('/youtube/videos',
            authenticateMiddleware([{"jwt":["youtube_access"]}]),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController)),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController.prototype.getVideos)),

            async function YouTubeController_getVideos(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsYouTubeController_getVideos, request, response });

                const controller = new YouTubeController();

              await templateService.apiHandler({
                methodName: 'getVideos',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsYouTubeController_setVideoWatched: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                videoId: {"in":"path","name":"videoId","required":true,"dataType":"string"},
                body: {"in":"body","name":"body","required":true,"ref":"WatchedBody"},
        };
        app.patch('/youtube/videos/:videoId/watched',
            authenticateMiddleware([{"jwt":["youtube_access"]}]),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController)),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController.prototype.setVideoWatched)),

            async function YouTubeController_setVideoWatched(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsYouTubeController_setVideoWatched, request, response });

                const controller = new YouTubeController();

              await templateService.apiHandler({
                methodName: 'setVideoWatched',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsYouTubeController_getVideosCarousel: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        app.get('/youtube/videos/carousel',
            authenticateMiddleware([{"jwt":["youtube_access"]}]),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController)),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController.prototype.getVideosCarousel)),

            async function YouTubeController_getVideosCarousel(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsYouTubeController_getVideosCarousel, request, response });

                const controller = new YouTubeController();

              await templateService.apiHandler({
                methodName: 'getVideosCarousel',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsYouTubeController_getNotificationSettings: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        app.get('/youtube/notification-settings',
            authenticateMiddleware([{"jwt":["youtube_access"]}]),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController)),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController.prototype.getNotificationSettings)),

            async function YouTubeController_getNotificationSettings(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsYouTubeController_getNotificationSettings, request, response });

                const controller = new YouTubeController();

              await templateService.apiHandler({
                methodName: 'getNotificationSettings',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsYouTubeController_updateNotificationSettings: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                body: {"in":"body","name":"body","required":true,"ref":"NotificationSettingsBody"},
        };
        app.patch('/youtube/notification-settings',
            authenticateMiddleware([{"jwt":["youtube_access"]}]),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController)),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController.prototype.updateNotificationSettings)),

            async function YouTubeController_updateNotificationSettings(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsYouTubeController_updateNotificationSettings, request, response });

                const controller = new YouTubeController();

              await templateService.apiHandler({
                methodName: 'updateNotificationSettings',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsYouTubeController_getAccess: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        app.get('/youtube/access',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController)),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController.prototype.getAccess)),

            async function YouTubeController_getAccess(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsYouTubeController_getAccess, request, response });

                const controller = new YouTubeController();

              await templateService.apiHandler({
                methodName: 'getAccess',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsYouTubeController_getAvailability: Record<string, TsoaRoute.ParameterSchema> = {
        };
        app.get('/youtube/availability',
            ...(fetchMiddlewares<RequestHandler>(YouTubeController)),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController.prototype.getAvailability)),

            async function YouTubeController_getAvailability(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsYouTubeController_getAvailability, request, response });

                const controller = new YouTubeController();

              await templateService.apiHandler({
                methodName: 'getAvailability',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsYouTubeController_unsubscribeFromDigest: Record<string, TsoaRoute.ParameterSchema> = {
                body: {"in":"body","name":"body","required":true,"ref":"UnsubscribeBody"},
        };
        app.post('/youtube/digest/unsubscribe',
            ...(fetchMiddlewares<RequestHandler>(YouTubeController)),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController.prototype.unsubscribeFromDigest)),

            async function YouTubeController_unsubscribeFromDigest(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsYouTubeController_unsubscribeFromDigest, request, response });

                const controller = new YouTubeController();

              await templateService.apiHandler({
                methodName: 'unsubscribeFromDigest',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsYouTubeController_cronSync: Record<string, TsoaRoute.ParameterSchema> = {
        };
        app.post('/youtube/cron/sync',
            authenticateMiddleware([{"cron-secret":[]}]),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController)),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController.prototype.cronSync)),

            async function YouTubeController_cronSync(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsYouTubeController_cronSync, request, response });

                const controller = new YouTubeController();

              await templateService.apiHandler({
                methodName: 'cronSync',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsYouTubeController_cronDigest: Record<string, TsoaRoute.ParameterSchema> = {
        };
        app.post('/youtube/cron/digest',
            authenticateMiddleware([{"cron-secret":[]}]),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController)),
            ...(fetchMiddlewares<RequestHandler>(YouTubeController.prototype.cronDigest)),

            async function YouTubeController_cronDigest(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsYouTubeController_cronDigest, request, response });

                const controller = new YouTubeController();

              await templateService.apiHandler({
                methodName: 'cronDigest',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsVaultController_getVaultMeta: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        app.get('/vault',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<RequestHandler>(VaultController)),
            ...(fetchMiddlewares<RequestHandler>(VaultController.prototype.getVaultMeta)),

            async function VaultController_getVaultMeta(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsVaultController_getVaultMeta, request, response });

                const controller = new VaultController();

              await templateService.apiHandler({
                methodName: 'getVaultMeta',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsVaultController_putVaultMeta: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                requestBody: {"in":"body","name":"requestBody","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"meta":{"ref":"VaultMetaV1","required":true}}},
                ifMatch: {"in":"header","name":"if-match","dataType":"string"},
        };
        app.put('/vault',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<RequestHandler>(VaultController)),
            ...(fetchMiddlewares<RequestHandler>(VaultController.prototype.putVaultMeta)),

            async function VaultController_putVaultMeta(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsVaultController_putVaultMeta, request, response });

                const controller = new VaultController();

              await templateService.apiHandler({
                methodName: 'putVaultMeta',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsVaultController_getVaultBlob: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                type: {"in":"path","name":"type","required":true,"ref":"VaultBlobType"},
                notModified: {"in":"res","name":"304","required":true,"dataType":"void"},
                ifNoneMatch: {"in":"header","name":"if-none-match","dataType":"string"},
        };
        app.get('/vault/blob/:type',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<RequestHandler>(VaultController)),
            ...(fetchMiddlewares<RequestHandler>(VaultController.prototype.getVaultBlob)),

            async function VaultController_getVaultBlob(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsVaultController_getVaultBlob, request, response });

                const controller = new VaultController();

              await templateService.apiHandler({
                methodName: 'getVaultBlob',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsVaultController_getVaultBlobInventory: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                notModified: {"in":"res","name":"304","required":true,"dataType":"void"},
                ifNoneMatch: {"in":"header","name":"if-none-match","dataType":"string"},
        };
        app.get('/vault/blobs',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<RequestHandler>(VaultController)),
            ...(fetchMiddlewares<RequestHandler>(VaultController.prototype.getVaultBlobInventory)),

            async function VaultController_getVaultBlobInventory(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsVaultController_getVaultBlobInventory, request, response });

                const controller = new VaultController();

              await templateService.apiHandler({
                methodName: 'getVaultBlobInventory',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsVaultController_putVaultBlob: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                type: {"in":"path","name":"type","required":true,"ref":"VaultBlobType"},
                requestBody: {"in":"body","name":"requestBody","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"blob":{"ref":"EncryptedBlobV1","required":true},"type":{"ref":"VaultBlobType","required":true}}},
                ifMatch: {"in":"header","name":"if-match","dataType":"string"},
        };
        app.put('/vault/blob/:type',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<RequestHandler>(VaultController)),
            ...(fetchMiddlewares<RequestHandler>(VaultController.prototype.putVaultBlob)),

            async function VaultController_putVaultBlob(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsVaultController_putVaultBlob, request, response });

                const controller = new VaultController();

              await templateService.apiHandler({
                methodName: 'putVaultBlob',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsVaultController_exportVault: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        app.post('/vault/export',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<RequestHandler>(VaultController)),
            ...(fetchMiddlewares<RequestHandler>(VaultController.prototype.exportVault)),

            async function VaultController_exportVault(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsVaultController_exportVault, request, response });

                const controller = new VaultController();

              await templateService.apiHandler({
                methodName: 'exportVault',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsVaultController_importVault: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                requestBody: {"in":"body","name":"requestBody","required":true,"ref":"VaultExportV1"},
        };
        app.post('/vault/import',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<RequestHandler>(VaultController)),
            ...(fetchMiddlewares<RequestHandler>(VaultController.prototype.importVault)),

            async function VaultController_importVault(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsVaultController_importVault, request, response });

                const controller = new VaultController();

              await templateService.apiHandler({
                methodName: 'importVault',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsVaultBackupController_recordBackup: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                body: {"in":"body","name":"body","required":true,"ref":"RecordVaultBackupRequest"},
        };
        app.post('/vault/backups',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<RequestHandler>(VaultBackupController)),
            ...(fetchMiddlewares<RequestHandler>(VaultBackupController.prototype.recordBackup)),

            async function VaultBackupController_recordBackup(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsVaultBackupController_recordBackup, request, response });

                const controller = new VaultBackupController();

              await templateService.apiHandler({
                methodName: 'recordBackup',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsVaultBackupController_getLatestBackup: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                status: {"in":"query","name":"status","ref":"VaultBackupStatus"},
                source: {"in":"query","name":"source","ref":"VaultBackupSource"},
                event: {"in":"query","name":"event","ref":"VaultBackupEvent"},
        };
        app.get('/vault/backups/latest',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<RequestHandler>(VaultBackupController)),
            ...(fetchMiddlewares<RequestHandler>(VaultBackupController.prototype.getLatestBackup)),

            async function VaultBackupController_getLatestBackup(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsVaultBackupController_getLatestBackup, request, response });

                const controller = new VaultBackupController();

              await templateService.apiHandler({
                methodName: 'getLatestBackup',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsVaultBackupController_listBackups: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                cursor: {"in":"query","name":"cursor","dataType":"string"},
                limit: {"in":"query","name":"limit","dataType":"double"},
                source: {"in":"query","name":"source","ref":"VaultBackupSource"},
        };
        app.get('/vault/backups',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<RequestHandler>(VaultBackupController)),
            ...(fetchMiddlewares<RequestHandler>(VaultBackupController.prototype.listBackups)),

            async function VaultBackupController_listBackups(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsVaultBackupController_listBackups, request, response });

                const controller = new VaultBackupController();

              await templateService.apiHandler({
                methodName: 'listBackups',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsUserDeletionController_deleteMe: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                requestBody: {"in":"body","name":"requestBody","required":true,"ref":"UserDeletionBody"},
                respond: {"in":"res","name":"409","required":true,"ref":"UserDeletionRefusal"},
        };
        app.delete('/users/me',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<RequestHandler>(UserDeletionController)),
            ...(fetchMiddlewares<RequestHandler>(UserDeletionController.prototype.deleteMe)),

            async function UserDeletionController_deleteMe(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsUserDeletionController_deleteMe, request, response });

                const controller = new UserDeletionController();

              await templateService.apiHandler({
                methodName: 'deleteMe',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 204,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsFeedbackReleaseController_markRelease: Record<string, TsoaRoute.ParameterSchema> = {
                body: {"in":"body","name":"body","required":true,"ref":"MarkFeedbackReleaseRequest"},
        };
        app.post('/feedback/releases/mark',
            authenticateMiddleware([{"deploy-secret":[]}]),
            ...(fetchMiddlewares<RequestHandler>(FeedbackReleaseController)),
            ...(fetchMiddlewares<RequestHandler>(FeedbackReleaseController.prototype.markRelease)),

            async function FeedbackReleaseController_markRelease(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsFeedbackReleaseController_markRelease, request, response });

                const controller = new FeedbackReleaseController();

              await templateService.apiHandler({
                methodName: 'markRelease',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsFeedbackPublicController_unsubscribeFromFixNotices: Record<string, TsoaRoute.ParameterSchema> = {
                body: {"in":"body","name":"body","required":true,"ref":"FixNoticeUnsubscribeBody"},
        };
        app.post('/feedback/fix-notice/unsubscribe',
            ...(fetchMiddlewares<RequestHandler>(FeedbackPublicController)),
            ...(fetchMiddlewares<RequestHandler>(FeedbackPublicController.prototype.unsubscribeFromFixNotices)),

            async function FeedbackPublicController_unsubscribeFromFixNotices(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsFeedbackPublicController_unsubscribeFromFixNotices, request, response });

                const controller = new FeedbackPublicController();

              await templateService.apiHandler({
                methodName: 'unsubscribeFromFixNotices',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsFeedbackController_createReport: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                body: {"in":"body","name":"body","required":true,"ref":"CreateFeedbackReportRequest"},
        };
        app.post('/feedback/reports',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<RequestHandler>(FeedbackController)),
            ...(fetchMiddlewares<RequestHandler>(FeedbackController.prototype.createReport)),

            async function FeedbackController_createReport(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsFeedbackController_createReport, request, response });

                const controller = new FeedbackController();

              await templateService.apiHandler({
                methodName: 'createReport',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 201,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsFeedbackController_listReports: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        app.get('/feedback/reports',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<RequestHandler>(FeedbackController)),
            ...(fetchMiddlewares<RequestHandler>(FeedbackController.prototype.listReports)),

            async function FeedbackController_listReports(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsFeedbackController_listReports, request, response });

                const controller = new FeedbackController();

              await templateService.apiHandler({
                methodName: 'listReports',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsFeedbackController_markReportsSeen: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        app.post('/feedback/reports/seen',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<RequestHandler>(FeedbackController)),
            ...(fetchMiddlewares<RequestHandler>(FeedbackController.prototype.markReportsSeen)),

            async function FeedbackController_markReportsSeen(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsFeedbackController_markReportsSeen, request, response });

                const controller = new FeedbackController();

              await templateService.apiHandler({
                methodName: 'markReportsSeen',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsFeedbackController_addFollowUp: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                reportId: {"in":"path","name":"reportId","required":true,"dataType":"string"},
                body: {"in":"body","name":"body","required":true,"ref":"AddFollowUpRequest"},
        };
        app.post('/feedback/reports/:reportId/follow-up',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<RequestHandler>(FeedbackController)),
            ...(fetchMiddlewares<RequestHandler>(FeedbackController.prototype.addFollowUp)),

            async function FeedbackController_addFollowUp(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsFeedbackController_addFollowUp, request, response });

                const controller = new FeedbackController();

              await templateService.apiHandler({
                methodName: 'addFollowUp',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAuthController_login: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                requestBody: {"in":"body","name":"requestBody","required":true,"ref":"UserLoginBody"},
                unauthorized: {"in":"res","name":"401","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"message":{"dataType":"string","required":true}}},
                forbidden: {"in":"res","name":"403","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"message":{"dataType":"string","required":true}}},
        };
        app.post('/auth/login',
            ...(fetchMiddlewares<RequestHandler>(AuthController)),
            ...(fetchMiddlewares<RequestHandler>(AuthController.prototype.login)),

            async function AuthController_login(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAuthController_login, request, response });

                const controller = new AuthController();

              await templateService.apiHandler({
                methodName: 'login',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAuthController_logout: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                userId: {"in":"path","name":"userId","required":true,"dataType":"string"},
                requestBody: {"in":"body","name":"requestBody","ref":"RefreshTokenBody"},
        };
        app.post('/auth/logout/:userId',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<RequestHandler>(AuthController)),
            ...(fetchMiddlewares<RequestHandler>(AuthController.prototype.logout)),

            async function AuthController_logout(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAuthController_logout, request, response });

                const controller = new AuthController();

              await templateService.apiHandler({
                methodName: 'logout',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAuthController_refreshToken: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                unauthorized: {"in":"res","name":"401","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"message":{"dataType":"string","required":true}}},
                forbidden: {"in":"res","name":"403","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"message":{"dataType":"string","required":true}}},
                requestBody: {"in":"body","name":"requestBody","ref":"RefreshTokenBody"},
        };
        app.post('/auth/refresh',
            ...(fetchMiddlewares<RequestHandler>(AuthController)),
            ...(fetchMiddlewares<RequestHandler>(AuthController.prototype.refreshToken)),

            async function AuthController_refreshToken(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAuthController_refreshToken, request, response });

                const controller = new AuthController();

              await templateService.apiHandler({
                methodName: 'refreshToken',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAuthController_registerUser: Record<string, TsoaRoute.ParameterSchema> = {
                requestBody: {"in":"body","name":"requestBody","required":true,"ref":"UserCreationBody"},
        };
        app.post('/auth/register',
            ...(fetchMiddlewares<RequestHandler>(AuthController)),
            ...(fetchMiddlewares<RequestHandler>(AuthController.prototype.registerUser)),

            async function AuthController_registerUser(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAuthController_registerUser, request, response });

                const controller = new AuthController();

              await templateService.apiHandler({
                methodName: 'registerUser',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 201,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAuthController_verifyEmail: Record<string, TsoaRoute.ParameterSchema> = {
                requestBody: {"in":"body","name":"requestBody","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"token":{"dataType":"string","required":true}}},
        };
        app.patch('/auth/verify/email',
            ...(fetchMiddlewares<RequestHandler>(AuthController)),
            ...(fetchMiddlewares<RequestHandler>(AuthController.prototype.verifyEmail)),

            async function AuthController_verifyEmail(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAuthController_verifyEmail, request, response });

                const controller = new AuthController();

              await templateService.apiHandler({
                methodName: 'verifyEmail',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAuthController_resendVerificationEmailByEmail: Record<string, TsoaRoute.ParameterSchema> = {
                requestBody: {"in":"body","name":"requestBody","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"email":{"dataType":"string","required":true}}},
        };
        app.post('/auth/verify/resend',
            ...(fetchMiddlewares<RequestHandler>(AuthController)),
            ...(fetchMiddlewares<RequestHandler>(AuthController.prototype.resendVerificationEmailByEmail)),

            async function AuthController_resendVerificationEmailByEmail(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAuthController_resendVerificationEmailByEmail, request, response });

                const controller = new AuthController();

              await templateService.apiHandler({
                methodName: 'resendVerificationEmailByEmail',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAuthController_resendVerificationEmail: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                userId: {"in":"path","name":"userId","required":true,"dataType":"string"},
        };
        app.post('/auth/verify/resend/:userId',
            authenticateMiddleware([{"jwt":[]}]),
            ...(fetchMiddlewares<RequestHandler>(AuthController)),
            ...(fetchMiddlewares<RequestHandler>(AuthController.prototype.resendVerificationEmail)),

            async function AuthController_resendVerificationEmail(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAuthController_resendVerificationEmail, request, response });

                const controller = new AuthController();

              await templateService.apiHandler({
                methodName: 'resendVerificationEmail',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAuthController_resetPassword: Record<string, TsoaRoute.ParameterSchema> = {
                requestBody: {"in":"body","name":"requestBody","required":true,"ref":"ResetPasswordByEmailBody"},
        };
        app.post('/auth/password/reset',
            ...(fetchMiddlewares<RequestHandler>(AuthController)),
            ...(fetchMiddlewares<RequestHandler>(AuthController.prototype.resetPassword)),

            async function AuthController_resetPassword(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAuthController_resetPassword, request, response });

                const controller = new AuthController();

              await templateService.apiHandler({
                methodName: 'resetPassword',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAuthController_confirmResetPassword: Record<string, TsoaRoute.ParameterSchema> = {
                requestBody: {"in":"body","name":"requestBody","required":true,"ref":"ConfirmResetPasswordBody"},
        };
        app.patch('/auth/password/reset/confirm',
            ...(fetchMiddlewares<RequestHandler>(AuthController)),
            ...(fetchMiddlewares<RequestHandler>(AuthController.prototype.confirmResetPassword)),

            async function AuthController_confirmResetPassword(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAuthController_confirmResetPassword, request, response });

                const controller = new AuthController();

              await templateService.apiHandler({
                methodName: 'confirmResetPassword',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAdminYouTubeAccessController_getYouTubeAccessUsage: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        app.get('/admin/youtube-access',
            authenticateMiddleware([{"jwt":["platform_admin"]}]),
            ...(fetchMiddlewares<RequestHandler>(AdminYouTubeAccessController)),
            ...(fetchMiddlewares<RequestHandler>(AdminYouTubeAccessController.prototype.getYouTubeAccessUsage)),

            async function AdminYouTubeAccessController_getYouTubeAccessUsage(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAdminYouTubeAccessController_getYouTubeAccessUsage, request, response });

                const controller = new AdminYouTubeAccessController();

              await templateService.apiHandler({
                methodName: 'getYouTubeAccessUsage',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAdminUsersController_listUsers: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                q: {"in":"query","name":"q","dataType":"string"},
        };
        app.get('/admin/users',
            authenticateMiddleware([{"jwt":["platform_admin"]}]),
            ...(fetchMiddlewares<RequestHandler>(AdminUsersController)),
            ...(fetchMiddlewares<RequestHandler>(AdminUsersController.prototype.listUsers)),

            async function AdminUsersController_listUsers(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAdminUsersController_listUsers, request, response });

                const controller = new AdminUsersController();

              await templateService.apiHandler({
                methodName: 'listUsers',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAdminUsersController_getUserById: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                userId: {"in":"path","name":"userId","required":true,"dataType":"string"},
                notFound: {"in":"res","name":"404","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"message":{"dataType":"string","required":true}}},
        };
        app.get('/admin/users/:userId',
            authenticateMiddleware([{"jwt":["platform_admin"]}]),
            ...(fetchMiddlewares<RequestHandler>(AdminUsersController)),
            ...(fetchMiddlewares<RequestHandler>(AdminUsersController.prototype.getUserById)),

            async function AdminUsersController_getUserById(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAdminUsersController_getUserById, request, response });

                const controller = new AdminUsersController();

              await templateService.apiHandler({
                methodName: 'getUserById',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAdminUsersController_disableUser: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                userId: {"in":"path","name":"userId","required":true,"dataType":"string"},
                notFound: {"in":"res","name":"404","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"message":{"dataType":"string","required":true}}},
        };
        app.post('/admin/users/:userId/disable',
            authenticateMiddleware([{"jwt":["platform_admin"]}]),
            ...(fetchMiddlewares<RequestHandler>(AdminUsersController)),
            ...(fetchMiddlewares<RequestHandler>(AdminUsersController.prototype.disableUser)),

            async function AdminUsersController_disableUser(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAdminUsersController_disableUser, request, response });

                const controller = new AdminUsersController();

              await templateService.apiHandler({
                methodName: 'disableUser',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAdminUsersController_enableUser: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                userId: {"in":"path","name":"userId","required":true,"dataType":"string"},
                notFound: {"in":"res","name":"404","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"message":{"dataType":"string","required":true}}},
        };
        app.post('/admin/users/:userId/enable',
            authenticateMiddleware([{"jwt":["platform_admin"]}]),
            ...(fetchMiddlewares<RequestHandler>(AdminUsersController)),
            ...(fetchMiddlewares<RequestHandler>(AdminUsersController.prototype.enableUser)),

            async function AdminUsersController_enableUser(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAdminUsersController_enableUser, request, response });

                const controller = new AdminUsersController();

              await templateService.apiHandler({
                methodName: 'enableUser',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAdminUsersController_forceLogoutUser: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                userId: {"in":"path","name":"userId","required":true,"dataType":"string"},
                notFound: {"in":"res","name":"404","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"message":{"dataType":"string","required":true}}},
        };
        app.post('/admin/users/:userId/force-logout',
            authenticateMiddleware([{"jwt":["platform_admin"]}]),
            ...(fetchMiddlewares<RequestHandler>(AdminUsersController)),
            ...(fetchMiddlewares<RequestHandler>(AdminUsersController.prototype.forceLogoutUser)),

            async function AdminUsersController_forceLogoutUser(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAdminUsersController_forceLogoutUser, request, response });

                const controller = new AdminUsersController();

              await templateService.apiHandler({
                methodName: 'forceLogoutUser',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAdminUsersController_resendVerification: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                userId: {"in":"path","name":"userId","required":true,"dataType":"string"},
                notFound: {"in":"res","name":"404","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"message":{"dataType":"string","required":true}}},
                conflict: {"in":"res","name":"409","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"message":{"dataType":"string","required":true}}},
                tooMany: {"in":"res","name":"429","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"message":{"dataType":"string","required":true}}},
        };
        app.post('/admin/users/:userId/resend-verification',
            authenticateMiddleware([{"jwt":["platform_admin"]}]),
            ...(fetchMiddlewares<RequestHandler>(AdminUsersController)),
            ...(fetchMiddlewares<RequestHandler>(AdminUsersController.prototype.resendVerification)),

            async function AdminUsersController_resendVerification(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAdminUsersController_resendVerification, request, response });

                const controller = new AdminUsersController();

              await templateService.apiHandler({
                methodName: 'resendVerification',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAdminUsersController_promoteUser: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                userId: {"in":"path","name":"userId","required":true,"dataType":"string"},
                notFound: {"in":"res","name":"404","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"message":{"dataType":"string","required":true}}},
        };
        app.post('/admin/users/:userId/promote',
            authenticateMiddleware([{"jwt":["platform_admin"]}]),
            ...(fetchMiddlewares<RequestHandler>(AdminUsersController)),
            ...(fetchMiddlewares<RequestHandler>(AdminUsersController.prototype.promoteUser)),

            async function AdminUsersController_promoteUser(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAdminUsersController_promoteUser, request, response });

                const controller = new AdminUsersController();

              await templateService.apiHandler({
                methodName: 'promoteUser',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAdminUsersController_demoteUser: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                userId: {"in":"path","name":"userId","required":true,"dataType":"string"},
                notFound: {"in":"res","name":"404","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"message":{"dataType":"string","required":true}}},
                conflict: {"in":"res","name":"409","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"message":{"dataType":"string","required":true}}},
        };
        app.post('/admin/users/:userId/demote',
            authenticateMiddleware([{"jwt":["platform_admin"]}]),
            ...(fetchMiddlewares<RequestHandler>(AdminUsersController)),
            ...(fetchMiddlewares<RequestHandler>(AdminUsersController.prototype.demoteUser)),

            async function AdminUsersController_demoteUser(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAdminUsersController_demoteUser, request, response });

                const controller = new AdminUsersController();

              await templateService.apiHandler({
                methodName: 'demoteUser',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAdminUsersController_grantYouTubeAccess: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                userId: {"in":"path","name":"userId","required":true,"dataType":"string"},
                notFound: {"in":"res","name":"404","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"message":{"dataType":"string","required":true}}},
                conflict: {"in":"res","name":"409","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"message":{"dataType":"string","required":true}}},
        };
        app.post('/admin/users/:userId/youtube-access/grant',
            authenticateMiddleware([{"jwt":["platform_admin"]}]),
            ...(fetchMiddlewares<RequestHandler>(AdminUsersController)),
            ...(fetchMiddlewares<RequestHandler>(AdminUsersController.prototype.grantYouTubeAccess)),

            async function AdminUsersController_grantYouTubeAccess(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAdminUsersController_grantYouTubeAccess, request, response });

                const controller = new AdminUsersController();

              await templateService.apiHandler({
                methodName: 'grantYouTubeAccess',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAdminUsersController_withdrawYouTubeAccess: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                userId: {"in":"path","name":"userId","required":true,"dataType":"string"},
                notFound: {"in":"res","name":"404","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"message":{"dataType":"string","required":true}}},
        };
        app.post('/admin/users/:userId/youtube-access/withdraw',
            authenticateMiddleware([{"jwt":["platform_admin"]}]),
            ...(fetchMiddlewares<RequestHandler>(AdminUsersController)),
            ...(fetchMiddlewares<RequestHandler>(AdminUsersController.prototype.withdrawYouTubeAccess)),

            async function AdminUsersController_withdrawYouTubeAccess(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAdminUsersController_withdrawYouTubeAccess, request, response });

                const controller = new AdminUsersController();

              await templateService.apiHandler({
                methodName: 'withdrawYouTubeAccess',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAdminFeedbackController_listFeedbackReports: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                status: {"in":"query","name":"status","ref":"FeedbackReportStatus"},
                kind: {"in":"query","name":"kind","ref":"FeedbackReportKind"},
                platform: {"in":"query","name":"platform","dataType":"string"},
                trackingIssueNumber: {"in":"query","name":"trackingIssueNumber","dataType":"double"},
                limit: {"in":"query","name":"limit","dataType":"double"},
        };
        app.get('/admin/feedback/reports',
            authenticateMiddleware([{"jwt":["platform_admin"]}]),
            ...(fetchMiddlewares<RequestHandler>(AdminFeedbackController)),
            ...(fetchMiddlewares<RequestHandler>(AdminFeedbackController.prototype.listFeedbackReports)),

            async function AdminFeedbackController_listFeedbackReports(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAdminFeedbackController_listFeedbackReports, request, response });

                const controller = new AdminFeedbackController();

              await templateService.apiHandler({
                methodName: 'listFeedbackReports',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAdminFeedbackController_getFeedbackReport: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                reportId: {"in":"path","name":"reportId","required":true,"dataType":"string"},
        };
        app.get('/admin/feedback/reports/:reportId',
            authenticateMiddleware([{"jwt":["platform_admin"]}]),
            ...(fetchMiddlewares<RequestHandler>(AdminFeedbackController)),
            ...(fetchMiddlewares<RequestHandler>(AdminFeedbackController.prototype.getFeedbackReport)),

            async function AdminFeedbackController_getFeedbackReport(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAdminFeedbackController_getFeedbackReport, request, response });

                const controller = new AdminFeedbackController();

              await templateService.apiHandler({
                methodName: 'getFeedbackReport',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAdminFeedbackController_changeFeedbackReportStatus: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                reportId: {"in":"path","name":"reportId","required":true,"dataType":"string"},
                body: {"in":"body","name":"body","required":true,"ref":"ChangeFeedbackReportStatusRequest"},
        };
        app.patch('/admin/feedback/reports/:reportId/status',
            authenticateMiddleware([{"jwt":["platform_admin"]}]),
            ...(fetchMiddlewares<RequestHandler>(AdminFeedbackController)),
            ...(fetchMiddlewares<RequestHandler>(AdminFeedbackController.prototype.changeFeedbackReportStatus)),

            async function AdminFeedbackController_changeFeedbackReportStatus(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAdminFeedbackController_changeFeedbackReportStatus, request, response });

                const controller = new AdminFeedbackController();

              await templateService.apiHandler({
                methodName: 'changeFeedbackReportStatus',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAdminFeedbackController_linkFeedbackReportTrackingIssue: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                reportId: {"in":"path","name":"reportId","required":true,"dataType":"string"},
                body: {"in":"body","name":"body","required":true,"ref":"LinkFeedbackReportTrackingIssueRequest"},
        };
        app.put('/admin/feedback/reports/:reportId/tracking-issue',
            authenticateMiddleware([{"jwt":["platform_admin"]}]),
            ...(fetchMiddlewares<RequestHandler>(AdminFeedbackController)),
            ...(fetchMiddlewares<RequestHandler>(AdminFeedbackController.prototype.linkFeedbackReportTrackingIssue)),

            async function AdminFeedbackController_linkFeedbackReportTrackingIssue(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAdminFeedbackController_linkFeedbackReportTrackingIssue, request, response });

                const controller = new AdminFeedbackController();

              await templateService.apiHandler({
                methodName: 'linkFeedbackReportTrackingIssue',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAdminFeedbackController_unlinkFeedbackReportTrackingIssue: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                reportId: {"in":"path","name":"reportId","required":true,"dataType":"string"},
        };
        app.delete('/admin/feedback/reports/:reportId/tracking-issue',
            authenticateMiddleware([{"jwt":["platform_admin"]}]),
            ...(fetchMiddlewares<RequestHandler>(AdminFeedbackController)),
            ...(fetchMiddlewares<RequestHandler>(AdminFeedbackController.prototype.unlinkFeedbackReportTrackingIssue)),

            async function AdminFeedbackController_unlinkFeedbackReportTrackingIssue(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAdminFeedbackController_unlinkFeedbackReportTrackingIssue, request, response });

                const controller = new AdminFeedbackController();

              await templateService.apiHandler({
                methodName: 'unlinkFeedbackReportTrackingIssue',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAdminFeedbackController_markFeedbackReportDelivered: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                reportId: {"in":"path","name":"reportId","required":true,"dataType":"string"},
                body: {"in":"body","name":"body","required":true,"ref":"MarkFeedbackReportDeliveredRequest"},
        };
        app.post('/admin/feedback/reports/:reportId/delivery',
            authenticateMiddleware([{"jwt":["platform_admin"]}]),
            ...(fetchMiddlewares<RequestHandler>(AdminFeedbackController)),
            ...(fetchMiddlewares<RequestHandler>(AdminFeedbackController.prototype.markFeedbackReportDelivered)),

            async function AdminFeedbackController_markFeedbackReportDelivered(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAdminFeedbackController_markFeedbackReportDelivered, request, response });

                const controller = new AdminFeedbackController();

              await templateService.apiHandler({
                methodName: 'markFeedbackReportDelivered',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAdminAuditLogController_listAuditLogs: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                limit: {"in":"query","name":"limit","dataType":"double"},
        };
        app.get('/admin/audit-logs',
            authenticateMiddleware([{"jwt":["platform_admin"]}]),
            ...(fetchMiddlewares<RequestHandler>(AdminAuditLogController)),
            ...(fetchMiddlewares<RequestHandler>(AdminAuditLogController.prototype.listAuditLogs)),

            async function AdminAuditLogController_listAuditLogs(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAdminAuditLogController_listAuditLogs, request, response });

                const controller = new AdminAuditLogController();

              await templateService.apiHandler({
                methodName: 'listAuditLogs',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa


    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

    function authenticateMiddleware(security: TsoaRoute.Security[] = []) {
        return async function runAuthenticationMiddleware(request: any, response: any, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            // keep track of failed auth attempts so we can hand back the most
            // recent one.  This behavior was previously existing so preserving it
            // here
            const failedAttempts: any[] = [];
            const pushAndRethrow = (error: any) => {
                failedAttempts.push(error);
                throw error;
            };

            const secMethodOrPromises: Promise<any>[] = [];
            for (const secMethod of security) {
                if (Object.keys(secMethod).length > 1) {
                    const secMethodAndPromises: Promise<any>[] = [];

                    for (const name in secMethod) {
                        secMethodAndPromises.push(
                            expressAuthenticationRecasted(request, name, secMethod[name], response)
                                .catch(pushAndRethrow)
                        );
                    }

                    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

                    secMethodOrPromises.push(Promise.all(secMethodAndPromises)
                        .then(users => { return users[0]; }));
                } else {
                    for (const name in secMethod) {
                        secMethodOrPromises.push(
                            expressAuthenticationRecasted(request, name, secMethod[name], response)
                                .catch(pushAndRethrow)
                        );
                    }
                }
            }

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            try {
                request['user'] = await Promise.any(secMethodOrPromises);

                // Response was sent in middleware, abort
                if (response.writableEnded) {
                    return;
                }

                next();
            }
            catch(err) {
                // Show most recent error as response
                const error = failedAttempts.pop();
                error.status = error.status || 401;

                // Response was sent in middleware, abort
                if (response.writableEnded) {
                    return;
                }
                next(error);
            }

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        }
    }

    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
}

// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

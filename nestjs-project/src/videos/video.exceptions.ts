import { DomainException } from '../common/exceptions/domain.exception';

export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video not found');
  }
}

export class VideoPartInvalidException extends DomainException {
  constructor() {
    super(
      'VIDEO_PART_INVALID',
      400,
      'Part number is outside the upload session',
    );
  }
}

export class VideoUploadIncompleteException extends DomainException {
  constructor() {
    super(
      'VIDEO_UPLOAD_INCOMPLETE',
      409,
      'Uploaded parts do not match the session',
    );
  }
}

export class VideoUploadStateException extends DomainException {
  constructor() {
    super('VIDEO_UPLOAD_STATE', 409, 'Video upload is no longer open');
  }
}

export class VideoUploadExpiredException extends DomainException {
  constructor() {
    super('VIDEO_UPLOAD_EXPIRED', 410, 'Video upload has expired');
  }
}

export class VideoStorageUnavailableException extends DomainException {
  constructor(cause?: unknown) {
    super(
      'VIDEO_STORAGE_UNAVAILABLE',
      503,
      'Video storage is temporarily unavailable',
    );
    this.cause = cause;
  }
}

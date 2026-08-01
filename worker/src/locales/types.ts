export interface MessageCatalog {
  homeDescription: string;
  homeAudience: string;
  uploadDefaultTitle: string;
  allowedExtensions: string;
  allowedTypes: string;
  maxFileSize: string;
  deadline: string;
  uploadButton: string;
  uploadClient: {
    creating: string;
    initiateFailed: string;
    uploading: string;
    storageHttp: string;
    corsFailed: string;
    confirming: string;
    failedPrefix: string;
    retry: string;
  };
  successTitle: string;
  successHeading: string;
  successReceived: string;
  successClose: string;
  genericErrorTitle: string;
  errors: Record<string, { title: string; message: string }>;
}

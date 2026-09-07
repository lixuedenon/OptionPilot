// src/types/file-system-access.d.ts
// Ambient type augmentation for the File System Access API surface used by
// src/lib/autoSync.ts (window.showSaveFilePicker, and the permission-query
// methods on FileSystemFileHandle). TypeScript's bundled lib.dom.d.ts (as of
// the 5.6.x toolchain this project pins) already knows about
// FileSystemFileHandle/createWritable, but not about showSaveFilePicker or
// the queryPermission/requestPermission permission extension — those are
// still a separate, less-universally-adopted part of the spec. This file
// exists purely to make `npm run typecheck` pass; it adds no runtime code
// and changes no behavior. If a future TS/lib update ships these types
// itself, the declarations below simply become redundant (safe to delete,
// not a conflict — an ambient `interface` merges with, and can duplicate,
// an already-declared one).

interface FileSystemHandlePermissionDescriptor {
  mode?: "read" | "readwrite";
}

interface FileSystemHandle {
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}

interface Window {
  showSaveFilePicker(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
}
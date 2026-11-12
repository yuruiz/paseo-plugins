import {
  bundleSchema,
  nameSchema,
  secretSchema,
  imageSchema,
  type Secret,
  type SecretImage,
  type RequestedField,
  type SecretFile,
  fileSchema,
} from "../shared/contracts.js";
import { validSecretFile } from "../shared/files.js";

export interface SecretField extends Secret {
  id: number;
  kind: "text" | "image" | "file";
  format?: SecretFile["format"];
  file?: Omit<SecretFile, "name">;
  skipped?: boolean;
  image?: Omit<SecretImage, "name">;
}
interface FormState {
  fields: SecretField[];
  usage: "once" | "reusable";
  revision: number;
  activeIndex: number;
  status: "editing" | "saving" | "saved";
  error: string | null;
  retryable: boolean;
}

export function createSecretForm(
  submit: (
    secrets: Secret[],
    images: SecretImage[],
    skipped: string[],
    files: SecretFile[],
    usage: "once" | "reusable",
  ) => Promise<void>,
  requested?: RequestedField[],
  retry?: { available(): boolean; send(): Promise<void> },
) {
  let nextId = 1;
  let closed = false;
  let state: FormState = {
    fields: requested
      ? requested.map((field) => ({ ...field, id: nextId++, value: "" }))
      : [{ id: nextId++, name: "", value: "", kind: "text" }],
    usage: "once",
    revision: 0,
    activeIndex: 0,
    status: "editing",
    error: null,
    retryable: false,
  };
  const listeners = new Set<() => void>();
  function publish(next: FormState) {
    state = next;
    for (const listener of listeners) listener();
  }
  return {
    getState: () => state,
    setUsage(usage: "once" | "reusable") {
      if (closed || state.status !== "editing" || state.retryable) return;
      publish({ ...state, usage });
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    select(index: number) {
      if (closed || state.status !== "editing" || index < 0 || index >= state.fields.length) return;
      publish({ ...state, activeIndex: index });
    },
    next() {
      if (
        closed ||
        state.status !== "editing" ||
        !isSecretFieldReady(state.fields[state.activeIndex])
      )
        return;
      publish({ ...state, activeIndex: Math.min(state.activeIndex + 1, state.fields.length - 1) });
    },
    skip() {
      if (!requested || closed || state.status !== "editing") return;
      const fields = state.fields.map((field, index) =>
        index === state.activeIndex
          ? { ...field, skipped: true, value: "", image: undefined, file: undefined }
          : field,
      );
      publish({
        ...state,
        fields,
        error: null,
        revision: state.revision + 1,
        activeIndex: Math.min(state.activeIndex + 1, state.fields.length - 1),
      });
    },
    restore(id: number) {
      if (closed || state.status !== "editing") return;
      publish({
        ...state,
        error: null,
        fields: state.fields.map((field) =>
          field.id === id ? { ...field, skipped: false } : field,
        ),
      });
    },
    edit(id: number, field: "name" | "value", value: string) {
      if (closed || state.status !== "editing") return;
      const fields = state.fields.map((entry) =>
        entry.id === id && !entry.skipped ? { ...entry, [field]: value } : entry,
      );
      publish({ ...state, fields, error: null });
    },
    setImage(id: number, image: Omit<SecretImage, "name">) {
      if (closed || state.status !== "editing") return;
      publish({
        ...state,
        error: null,
        fields: state.fields.map((field) =>
          field.id === id && !field.skipped ? { ...field, image } : field,
        ),
      });
    },
    setFile(id: number, file: Omit<SecretFile, "name">) {
      if (closed || state.status !== "editing") return;
      publish({
        ...state,
        error: null,
        fields: state.fields.map((field) =>
          field.id === id && !field.skipped ? { ...field, file } : field,
        ),
      });
    },
    add(kind: "text" | "image" | "file" = "text") {
      if (requested || closed || state.status !== "editing" || state.fields.length >= 32) return;
      publish({ ...state, fields: [...state.fields, { id: nextId++, name: "", value: "", kind }] });
    },
    remove(id: number) {
      if (requested || closed || state.status !== "editing" || state.fields.length === 1) return;
      publish({ ...state, fields: state.fields.filter((field) => field.id !== id) });
    },
    async save() {
      if (closed || state.status !== "editing" || state.retryable) return;
      const skipped = state.fields.filter((field) => field.skipped).map((field) => field.name);
      const allSkipped = Boolean(requested) && skipped.length === state.fields.length;
      const parsed = bundleSchema.safeParse({
        files: state.fields
          .filter((field) => field.kind === "file" && !field.skipped)
          .map((field) => ({
            name: field.name,
            data: field.file?.data,
            format: field.file?.format,
          })),
        secrets: state.fields.filter((field) => field.kind === "text" && !field.skipped),
        images: state.fields
          .filter((field) => field.kind === "image" && !field.skipped)
          .map((field) => ({
            name: field.name,
            mimeType: field.image?.mimeType,
            data: field.image?.data,
          })),
      });
      if (
        (!parsed.success || parsed.data.files.some((file) => !validSecretFile(file))) &&
        !allSkipped
      ) {
        const missingIndex = state.fields.findIndex(
          (field) => !field.skipped && !isSecretFieldReady(field),
        );
        let error =
          "Use unique uppercase names. Text: 16 KiB each. Files: 128 KiB each. Images and files: 4 MiB total.";
        if (missingIndex >= 0) {
          const missing = state.fields[missingIndex];
          const label = nameSchema.safeParse(missing.name).success
            ? missing.name
            : `field ${missingIndex + 1}`;
          const action = {
            text: "Enter a secret value",
            image: "Choose an image",
            file: "Choose a valid file",
          }[missing.kind];
          error = `${action} for ${label}. This field is required.`;
        }
        publish({ ...state, error });
        return;
      }
      const data = parsed.success ? parsed.data : { secrets: [], images: [], files: [] };
      // Send directly: mutation/query caches and retry queues must never own raw values.
      const fields = state.fields.map((field) => ({
        ...field,
        value: "",
        image: undefined,
        file: undefined,
      }));
      publish({
        ...state,
        fields,
        activeIndex: 0,
        revision: state.revision + 1,
        status: "saving",
        error: null,
      });
      try {
        await submit(data.secrets, data.images, skipped, data.files, state.usage);
        if (!closed) publish({ ...state, status: "saved" });
      } catch {
        if (!closed)
          publish({
            ...state,
            status: "editing",
            retryable: retry?.available() ?? false,
            error: retry?.available()
              ? "Submission could not be confirmed. Retry the encrypted submission without entering the values again."
              : "Could not confirm submission. Check pending grants before retrying, then enter the values again.",
          });
      } finally {
        data.secrets.length = 0;
        data.images.length = 0;
        data.files.length = 0;
      }
    },
    async retry() {
      if (closed || !state.retryable || state.status === "saving" || !retry) return;
      publish({ ...state, status: "saving", error: null });
      try {
        await retry.send();
        if (!closed) publish({ ...state, status: "saved", retryable: false });
      } catch {
        if (!closed)
          publish({
            ...state,
            status: "editing",
            error: "Submission still unconfirmed. Retry or check pending grants.",
          });
      }
    },
    close() {
      closed = true;
      state = { ...state, fields: [] };
      listeners.clear();
    },
  };
}

export type SecretForm = ReturnType<typeof createSecretForm>;

export function isSecretFieldReady(field: SecretField) {
  if (field.skipped) return true;
  if (field.kind === "file")
    return (
      fileSchema.safeParse({ name: field.name, ...field.file }).success &&
      Boolean(field.file && validSecretFile(field.file))
    );
  return field.kind === "text"
    ? secretSchema.safeParse(field).success
    : imageSchema.safeParse({ name: field.name, ...field.image }).success;
}

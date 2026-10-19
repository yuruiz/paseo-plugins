import {
  bundleSchema,
  nameSchema,
  secretSchema,
  imageSchema,
  type Secret,
  type SecretImage,
  type RequestedField,
} from "../shared/contracts.js";

export interface SecretField extends Secret {
  id: number;
  kind: "text" | "image";
  skipped?: boolean;
  image?: Omit<SecretImage, "name">;
}
interface FormState {
  fields: SecretField[];
  revision: number;
  activeIndex: number;
  status: "editing" | "saving" | "saved";
  error: string | null;
}

export function createSecretForm(
  submit: (secrets: Secret[], images: SecretImage[], skipped: string[]) => Promise<void>,
  requested?: RequestedField[],
) {
  let nextId = 1;
  let closed = false;
  let state: FormState = {
    fields: requested
      ? requested.map((field) => ({ ...field, id: nextId++, value: "" }))
      : [{ id: nextId++, name: "", value: "", kind: "text" }],
    revision: 0,
    activeIndex: 0,
    status: "editing",
    error: null,
  };
  const listeners = new Set<() => void>();
  function publish(next: FormState) {
    state = next;
    for (const listener of listeners) listener();
  }
  return {
    getState: () => state,
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
          ? { ...field, skipped: true, value: "", image: undefined }
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
    add(kind: "text" | "image" = "text") {
      if (requested || closed || state.status !== "editing" || state.fields.length >= 32) return;
      publish({ ...state, fields: [...state.fields, { id: nextId++, name: "", value: "", kind }] });
    },
    remove(id: number) {
      if (requested || closed || state.status !== "editing" || state.fields.length === 1) return;
      publish({ ...state, fields: state.fields.filter((field) => field.id !== id) });
    },
    async save() {
      if (closed || state.status !== "editing") return;
      const skipped = state.fields.filter((field) => field.skipped).map((field) => field.name);
      const allSkipped = Boolean(requested) && skipped.length === state.fields.length;
      const parsed = bundleSchema.safeParse({
        secrets: state.fields.filter((field) => field.kind === "text" && !field.skipped),
        images: state.fields
          .filter((field) => field.kind === "image" && !field.skipped)
          .map((field) => ({
            name: field.name,
            mimeType: field.image?.mimeType,
            data: field.image?.data,
          })),
      });
      if (!parsed.success && !allSkipped) {
        const missingIndex = state.fields.findIndex(
          (field) => !field.skipped && (field.kind === "image" ? !field.image : !field.value),
        );
        let error =
          "Use unique uppercase names. Text: 16 KiB each. Images: up to four PNG, JPEG or WebP files, 4 MiB total.";
        if (missingIndex >= 0) {
          const missing = state.fields[missingIndex];
          const label = nameSchema.safeParse(missing.name).success
            ? missing.name
            : `field ${missingIndex + 1}`;
          error =
            missing.kind === "image"
              ? `Choose an image for ${label}. This field is required.`
              : `Enter a secret value for ${label}. This field is required.`;
        }
        publish({ ...state, error });
        return;
      }
      const data = parsed.success ? parsed.data : { secrets: [], images: [] };
      // Send directly: mutation/query caches and retry queues must never own raw values.
      const fields = state.fields.map((field) => ({ ...field, value: "", image: undefined }));
      publish({
        ...state,
        fields,
        activeIndex: 0,
        revision: state.revision + 1,
        status: "saving",
        error: null,
      });
      try {
        await submit(data.secrets, data.images, skipped);
        if (!closed) publish({ ...state, status: "saved" });
      } catch {
        if (!closed)
          publish({
            ...state,
            status: "editing",
            error:
              "Could not confirm submission. Check pending grants before retrying, then enter the values again.",
          });
      } finally {
        data.secrets.length = 0;
        data.images.length = 0;
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
  return field.kind === "text"
    ? secretSchema.safeParse(field).success
    : imageSchema.safeParse({ name: field.name, ...field.image }).success;
}

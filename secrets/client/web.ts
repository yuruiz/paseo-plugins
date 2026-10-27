import { Platform } from "react-native";
import { MAX_IMAGE_BYTES, type SecretImage } from "../shared/contracts.js";

interface FileValue {
  size: number;
  type: string;
}
interface FileInput {
  type: string;
  accept: string;
  hidden: boolean;
  files: ArrayLike<FileValue> | null;
  addEventListener(
    type: "change" | "cancel",
    listener: () => void,
    options: { once: boolean },
  ): void;
  click(): void;
  remove(): void;
}
declare const document: {
  createElement(tag: "input"): FileInput;
  body: { appendChild(input: FileInput): void };
};
declare const FileReader: {
  new (): {
    result: string | ArrayBuffer | null;
    addEventListener(
      type: "load" | "error",
      listener: () => void,
      options: { once: boolean },
    ): void;
    readAsDataURL(file: FileValue): void;
  };
};

export function canPickImage() {
  return Platform.OS === "web";
}

export async function pickImage(): Promise<Omit<SecretImage, "name"> | null> {
  if (Platform.OS !== "web") return null;
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp";
    input.hidden = true;
    input.addEventListener(
      "cancel",
      () => {
        input.remove();
        resolve(null);
      },
      { once: true },
    );
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) {
          resolve(null);
          return;
        }
        if (
          file.size > MAX_IMAGE_BYTES ||
          !["image/png", "image/jpeg", "image/webp"].includes(file.type)
        ) {
          reject(new Error("Choose a PNG, JPEG or WebP image up to 4 MiB."));
          return;
        }
        const reader = new FileReader();
        reader.addEventListener("error", () => reject(new Error("Could not read the image.")), {
          once: true,
        });
        reader.addEventListener(
          "load",
          () => {
            if (typeof reader.result !== "string") {
              reject(new Error("Could not read the image."));
              return;
            }
            resolve({
              mimeType: file.type as SecretImage["mimeType"],
              data: reader.result.slice(reader.result.indexOf(",") + 1),
            });
          },
          { once: true },
        );
        reader.readAsDataURL(file);
      },
      { once: true },
    );
    document.body.appendChild(input);
    input.click();
  });
}

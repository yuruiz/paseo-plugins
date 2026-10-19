import type { PluginHostProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import {
  submitSecrets,
  submitSecretRequest,
  type Grant,
  type SecretRequest,
} from "../shared/contracts.js";
import { canPickImage, pickImage } from "./web.js";
import { createSecretForm, isSecretFieldReady, type SecretField, type SecretForm } from "./form.js";
import { QuestionButton, useQuestionStyles } from "./question-ui.js";

interface FormProps extends PluginHostProps {
  agentId: string;
  request?: SecretRequest;
  onSaved(grant: Grant | null, skipped?: string[]): void;
  onDecline?(): void;
}

export function SecretsForm({ agentId, theme, layout, onSaved, request, onDecline }: FormProps) {
  const submit = useRpc(submitSecrets);
  const submitRequest = useRpc(submitSecretRequest);
  const [form] = useState(() =>
    createSecretForm(async (secrets, images, skipped) => {
      if (request) {
        const result = await submitRequest({
          agentId,
          requestId: request.id,
          secrets,
          images,
          skipped,
        });
        onSaved(result.grant, result.skipped);
      } else {
        onSaved(await submit({ agentId, secrets, images }));
      }
    }, request?.fields),
  );
  const state = useSyncExternalStore(form.subscribe, form.getState);
  useEffect(() => () => form.close(), [form]);
  const styles = useQuestionStyles(theme, layout.compact);
  const pending = state.status === "saving";
  const active = state.fields[state.activeIndex];
  const last = !request || state.activeIndex === state.fields.length - 1;
  const complete = state.fields.every(isSecretFieldReady);
  const allSkipped = state.fields.every((field) => field.skipped);
  const primary = useCallback(() => {
    if (request && !last) form.next();
    else void form.save();
  }, [form, request, last]);
  const skip = useCallback(() => {
    form.skip();
    if (last) {
      const next = form.getState();
      const unanswered = next.fields.findIndex((field) => !isSecretFieldReady(field));
      if (unanswered >= 0) form.select(unanswered);
      else void form.save();
    }
  }, [form, last]);
  const addText = useCallback(() => form.add("text"), [form]);
  const addImage = useCallback(() => form.add("image"), [form]);
  const primaryLabel = primaryActionLabel(pending, last, allSkipped);
  const disabled = pending || (Boolean(request) && !(last ? complete : isSecretFieldReady(active)));
  const fields = request ? [active] : state.fields;
  return (
    <View style={styles.card} testID="secrets-question-card">
      {state.status === "saved" ? (
        <Text style={styles.text}>{allSkipped ? "Request skipped" : "Secrets ready"}</Text>
      ) : (
        <>
          {request ? (
            <Text style={styles.text}>{request.purpose}</Text>
          ) : (
            <Text style={styles.text}>Provide secrets</Text>
          )}
          {request && state.fields.length > 1 ? (
            <View style={styles.tabs} accessibilityRole="tablist">
              {state.fields.map((field, index) => (
                <FieldTab
                  key={field.id}
                  theme={theme}
                  field={field}
                  index={index}
                  active={index === state.activeIndex}
                  disabled={pending}
                  form={form}
                />
              ))}
            </View>
          ) : null}
          {fields.map((field) => (
            <SecretInputs
              key={`${state.revision}:${field.id}`}
              theme={theme}
              form={form}
              field={field}
              pending={pending}
              fixed={Boolean(request)}
              onSubmit={primary}
            />
          ))}
          {!request ? (
            <View style={styles.row}>
              <QuestionButton
                theme={theme}
                label="Add variable"
                onPress={addText}
                disabled={pending}
              />
              {canPickImage() ? (
                <QuestionButton
                  theme={theme}
                  label="Add image"
                  onPress={addImage}
                  disabled={pending}
                />
              ) : null}
            </View>
          ) : null}
          <Text style={styles.muted}>Private input · One use · 10 minutes</Text>
          {state.error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {state.error}
            </Text>
          ) : null}
          <View style={styles.actions}>
            {onDecline ? (
              <QuestionButton
                theme={theme}
                label="Decline"
                icon="X"
                onPress={onDecline}
                disabled={pending}
              />
            ) : null}
            {request && !active.skipped ? (
              <QuestionButton
                theme={theme}
                label="Skip"
                icon="SkipForward"
                onPress={skip}
                disabled={pending}
              />
            ) : null}
            <QuestionButton
              theme={theme}
              label={primaryLabel}
              icon={last ? "Check" : "ArrowRight"}
              onPress={primary}
              disabled={disabled}
              primary
            />
          </View>
        </>
      )}
    </View>
  );
}

interface InputsProps {
  theme: PluginHostProps["theme"];
  form: SecretForm;
  field: SecretField;
  pending: boolean;
  fixed: boolean;
  onSubmit(): void;
}

function SecretInputs({ theme, form, field, pending, fixed, onSubmit }: InputsProps) {
  const styles = useQuestionStyles(theme);
  const [imageError, setImageError] = useState(false);
  const [reading, setReading] = useState(false);
  const choose = useCallback(() => {
    setImageError(false);
    setReading(true);
    void pickImage()
      .then((image) => {
        if (image) form.setImage(field.id, image);
        return undefined;
      })
      .catch(() => setImageError(true))
      .finally(() => setReading(false));
  }, [form, field.id]);
  const editName = useCallback(
    (value: string) => form.edit(field.id, "name", value),
    [form, field.id],
  );
  const editValue = useCallback(
    (value: string) => form.edit(field.id, "value", value),
    [form, field.id],
  );
  const restore = useCallback(() => form.restore(field.id), [form, field.id]);
  const remove = useCallback(() => form.remove(field.id), [form, field.id]);
  let imageAction = field.image ? "Replace image" : "Choose image";
  if (reading) imageAction = "Reading image...";
  const caption = field.kind === "image" ? "Choose an image" : "Enter a secret value";
  if (field.skipped)
    return (
      <View style={styles.field}>
        <Text style={styles.muted}>{field.name} skipped</Text>
        <QuestionButton
          theme={theme}
          label="Fill this field"
          onPress={restore}
          disabled={pending}
        />
      </View>
    );
  return (
    <View style={styles.field}>
      {fixed ? (
        <Text style={styles.text}>
          {caption}
          {field.name ? ` for ${field.name}` : ""}
        </Text>
      ) : (
        <TextInput
          accessibilityLabel="Environment variable"
          defaultValue={field.name}
          placeholder="API_TOKEN"
          placeholderTextColor={theme.colors.foregroundMuted}
          onChangeText={editName}
          editable={!pending}
          autoCapitalize="characters"
          autoCorrect={false}
          style={styles.input}
        />
      )}
      {field.kind === "image" ? (
        <View style={styles.image}>
          <Icon
            name={field.image ? "Check" : "ImagePlus"}
            size={24}
            color={theme.colors.foregroundMuted}
          />
          <Text style={styles.text}>
            {field.image ? "Private image selected" : "No image selected"}
          </Text>
          <Text style={styles.muted}>
            {canPickImage()
              ? "PNG, JPEG or WebP · Up to 4 MiB total"
              : "Open this request on desktop or in a browser to select an image"}
          </Text>
          <QuestionButton
            theme={theme}
            label={imageAction}
            onPress={choose}
            disabled={pending || reading || !canPickImage()}
          />
          {imageError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              Could not read image. Choose a PNG, JPEG or WebP file up to 4 MiB.
            </Text>
          ) : null}
        </View>
      ) : (
        <TextInput
          accessibilityLabel="Secret value"
          defaultValue={field.value}
          placeholder="Enter secret value"
          placeholderTextColor={theme.colors.foregroundMuted}
          secureTextEntry
          onChangeText={editValue}
          onSubmitEditing={onSubmit}
          editable={!pending}
          autoCorrect={false}
          autoCapitalize="none"
          autoComplete="off"
          style={styles.input}
        />
      )}
      {!fixed && form.getState().fields.length > 1 ? (
        <QuestionButton theme={theme} label="Remove" onPress={remove} disabled={pending} />
      ) : null}
    </View>
  );
}

function FieldTab({
  theme,
  field,
  index,
  active,
  disabled,
  form,
}: {
  theme: PluginHostProps["theme"];
  field: SecretField;
  index: number;
  active: boolean;
  disabled: boolean;
  form: SecretForm;
}) {
  const accessibilityState = useMemo(() => ({ selected: active }), [active]);
  const select = useCallback(() => form.select(index), [form, index]);
  const style = useMemo(
    () => ({
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
      minHeight: 28,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: active ? theme.colors.foregroundMuted : theme.colors.border,
      backgroundColor: active ? theme.colors.surface2 : theme.colors.surface1,
    }),
    [theme, active],
  );
  const textStyle = useMemo(
    () => ({
      color: active ? theme.colors.foreground : theme.colors.foregroundMuted,
      fontSize: 14,
    }),
    [theme, active],
  );
  return (
    <Pressable
      style={style}
      accessibilityRole="tab"
      accessibilityLabel={field.name}
      accessibilityState={accessibilityState}
      onPress={select}
      disabled={disabled}
    >
      {isSecretFieldReady(field) ? (
        <Icon name={field.skipped ? "SkipForward" : "Check"} size={12} color={textStyle.color} />
      ) : null}
      <Text style={textStyle}>
        {field.name}
        {field.skipped ? " · Skipped" : ""}
      </Text>
    </Pressable>
  );
}

function primaryActionLabel(pending: boolean, last: boolean, allSkipped: boolean) {
  if (pending) return "Submitting...";
  if (allSkipped) return "Finish";
  return last ? "Submit secrets" : "Next";
}

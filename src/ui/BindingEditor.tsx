import { useId, useState } from "react";
import {
  queryValues,
  setQueryValue,
  type HandshakeBinding,
} from "../engine/bindings";
import { InfoIcon } from "./icons";

interface Props {
  binding?: HandshakeBinding;
  url: string;
  disabled: boolean;
  active: boolean;
  onChange: (url: string) => void;
}

export function BindingEditor({
  binding,
  url,
  disabled,
  active,
  onChange,
}: Props) {
  const id = useId();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [omitted, setOmitted] = useState<Record<string, string>>({});
  const query = queryValues(url);
  const fields = [...(binding?.query ?? [])];
  const known = new Set(fields.map((field) => field.name));
  // Include URL-only parameters, including those added through the address bar.
  for (const key of new Set([...query.keys(), ...Object.keys(omitted)])) {
    if (!known.has(key)) fields.push({ name: key, required: false });
  }
  const change = (key: string, next: string | undefined) => {
    if (!disabled) onChange(setQueryValue(url, key, next));
  };
  return (
    <section className="aws-bindings" aria-label="WebSocket bindings">
      <h3 className="aws-label aws-row">
        Query parameters
        <span
          className="aws-binding-info"
          title="Sent in the connection URL when you connect, not with each message."
        >
          <InfoIcon />
        </span>
      </h3>
      {(active || disabled) && (
        <p className="aws-hint" style={{ margin: 0 }}>
          {active
            ? "Disconnect to edit handshake parameters."
            : "URL editing is turned off on this site."}
        </p>
      )}
      {fields.map((field, index) => {
        const inputId = `${id}-${index}`;
        const enabled = query.has(field.name);
        const current = query.get(field.name) ?? omitted[field.name] ?? "";
        const info = [field.type, field.description]
          .filter(Boolean)
          .join(" · ");
        return (
          <div className="aws-binding-field" key={field.name}>
            <div className="aws-row">
              <input
                type="checkbox"
                checked={enabled}
                disabled={disabled}
                aria-label={`Include ${field.name}`}
                onChange={(event) => {
                  if (!event.target.checked)
                    setOmitted((prev) => ({ ...prev, [field.name]: current }));
                  change(
                    field.name,
                    event.target.checked ? current : undefined
                  );
                }}
              />
              <label className="aws-binding-name" htmlFor={inputId}>
                {field.name}
                {field.required && (
                  <span title="Required by the schema"> *</span>
                )}
              </label>
              {info && (
                <span className="aws-binding-info" title={info}>
                  <InfoIcon />
                  <span id={`${inputId}-info`} className="aws-sr-only">
                    {info}
                  </span>
                </span>
              )}
              <input
                id={inputId}
                className="aws-input"
                value={current}
                disabled={disabled}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={info ? `${inputId}-info` : undefined}
                placeholder={field.required ? "Required" : "Value"}
                list={field.examples?.length ? `${inputId}-values` : undefined}
                onChange={(event) => change(field.name, event.target.value)}
              />
              {field.examples?.length ? (
                <datalist id={`${inputId}-values`}>
                  {field.examples.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              ) : null}
            </div>
            {field.required && !enabled && (
              <span className="aws-hint">
                Required by the spec; currently omitted.
              </span>
            )}
            {query.getAll(field.name).length > 1 && (
              <span className="aws-hint">
                Multiple values in the URL. Editing this field replaces them
                with one value.
              </span>
            )}
          </div>
        );
      })}
      <div className="aws-row aws-binding-add">
        <input
          className="aws-input"
          aria-label="New query parameter name"
          placeholder="Name"
          disabled={disabled}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="aws-input"
          aria-label="New query parameter value"
          placeholder="Value"
          disabled={disabled}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          type="button"
          className="aws-btn"
          disabled={
            disabled ||
            !name.trim() ||
            fields.some((field) => field.name === name.trim())
          }
          onClick={() => {
            change(name.trim(), value);
            setName("");
            setValue("");
          }}
        >
          + Add
        </button>
      </div>
      {!!binding?.headers.length && (
        <div className="aws-notice" data-tone="info">
          <strong>Handshake headers</strong>
          <p style={{ margin: ".375rem 0" }}>
            Browser WebSockets cannot set custom handshake headers. These are
            defined by the spec but cannot be edited here:
          </p>
          <ul className="aws-issues">
            {binding.headers.map((header) => (
              <li key={header.name}>
                <code>{header.name}</code>
                {header.required ? " (required)" : ""}
                {header.description ? ` — ${header.description}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {binding?.method && binding.method.toUpperCase() !== "GET" && (
        <div className="aws-notice" data-tone="warn">
          This binding requires {binding.method}. Browser WebSockets use GET, so
          this connection cannot be opened here.
        </div>
      )}
    </section>
  );
}

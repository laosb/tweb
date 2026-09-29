import {InputFieldTsx} from '@components/inputFieldTsx';
import {LangPackKey} from '@lib/langPack';

/** Native text/password inputs with Web K's field presentation and labels. */
export default function IdentityInput(props: {
  label: LangPackKey,
  type?: 'text' | 'password' | 'email' | 'url' | 'number',
  autocomplete?: string,
  value?: string,
  disabled?: boolean,
  onInput?: (value: string) => void,
  ref?: (input: HTMLInputElement) => void
}) {
  return <InputFieldTsx plainText label={props.label} value={props.value} disabled={props.disabled} onRawInput={(value) => { if(value !== props.value) props.onInput?.(value); }}
    autocomplete={props.autocomplete || 'off'} instanceRef={(field) => {
      const input = field.input as HTMLInputElement;
      input.type = props.type || 'text';
      input.autocapitalize = 'none';
      input.spellcheck = false;
      props.ref?.(input);
    }} />;
}

export class PasswordInputHelpers {
  passwordVisible = false;
}

export default class WidgetPasswordInput {
  container = document.createElement('div');
  input = document.createElement('input');
  helpers = new PasswordInputHelpers();
  getValue() { return this.input.value; }
  setValue(value: string) { this.input.value = value; }
}

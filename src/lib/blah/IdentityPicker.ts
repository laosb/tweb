import InputField, {InputFieldOptions} from '@components/inputField';
import Scrollable from '@components/scrollable';
import appNavigationController, {NavigationItem} from '@components/appNavigationController';
import styles from '@lib/blah/identity.module.scss';

export type IdentityPickerOption = {
  value: string,
  label: string,
  matches: (query: string) => boolean
};

let optionsId = 0;

/**
 * Blah-owned adaptation of CountryInputField. Keep the upstream phone picker
 * untouched for rebases; reuse its InputField, Scrollable, navigation and styles.
 */
export default class IdentityPicker extends InputField {
  private wrapper = document.createElement('div');
  private list = document.createElement('ul');
  private scroll: Scrollable;
  private entries: {option: IdentityPickerOption, element: HTMLLIElement}[] = [];
  private active = -1;
  private navigation: NavigationItem;
  private hideTimeout: number;
  private document: Document;

  constructor(options: InputFieldOptions, private onSelect: (value: string) => void) {
    // Safari can offer credentials on native inputs despite autocomplete=off.
    // Reuse Web K's editable-text control so only our identity suggestions appear.
    super({...options, plainText: undefined, withLinebreaks: false});
    const input = this.input;
    input.classList.add(styles.pickerInput);
    input.setAttribute('autocomplete', 'off');
    input.inputMode = 'text';
    input.autocapitalize = 'none';
    input.spellcheck = false;
    input.setAttribute('autocorrect', 'off');
    this.document = this.input.ownerDocument;
    this.container.classList.add('input-select');
    this.wrapper.classList.add('select-wrapper', 'z-depth-3', 'hide');
    this.wrapper.inert = true;
    this.list.id = `select-options-${++optionsId}`;
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-labelledby', this.label.id);
    this.list.classList.add('navigable-list');
    this.wrapper.append(this.list);
    this.scroll = new Scrollable(this.wrapper);
    this.container.append(this.wrapper);
    const arrow = document.createElement('span');
    arrow.classList.add('arrow', 'arrow-down');
    arrow.setAttribute('aria-hidden', 'true');
    this.container.append(arrow);
    this.input.setAttribute('role', 'combobox');
    this.input.removeAttribute('aria-multiline');
    this.input.setAttribute('aria-autocomplete', 'list');
    this.input.setAttribute('aria-controls', this.list.id);
    this.input.setAttribute('aria-expanded', 'false');
    this.input.addEventListener('focus', this.showPicker);
    this.input.addEventListener('input', () => {
      if(this.navigation) this.filter(this.value);
    });
    this.input.addEventListener('keydown', (event) => {
      if(event.isComposing) return;
      if(event.key === 'Tab') { this.hidePicker(); return; }
      if(!this.navigation) {
        if(event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        this.showPicker();
      }
      const visible = this.visible();
      if(!visible.length) return;
      let index = this.active;
      switch(event.key) {
        case 'ArrowDown': index = (index + 1) % visible.length; break;
        case 'ArrowUp': index = (index <= 0 ? visible.length : index) - 1; break;
        case 'Home': index = 0; break;
        case 'End': index = visible.length - 1; break;
        case 'Enter':
          if(index < 0 && visible.length !== 1) return;
          event.preventDefault();
          event.stopPropagation();
          this.choose(visible[Math.max(0, index)]);
          return;
        default: return;
      }
      event.preventDefault();
      this.setActive(index);
      visible[index].element.scrollIntoView({block: 'nearest'});
    });
    this.input.addEventListener('blur', () => this.hidePicker());
    arrow.addEventListener('mousedown', (event) => {
      event.preventDefault();
      if(this.navigation) this.hidePicker();
      else { this.input.focus(); this.showPicker(); }
    });
  }

  public setOptions(options: IdentityPickerOption[]) {
    this.list.replaceChildren();
    this.entries = options.map((option, index) => {
      const element = document.createElement('li');
      element.id = `${this.list.id}-${index}`;
      element.setAttribute('role', 'option');
      element.setAttribute('aria-selected', 'false');
      element.style.gridTemplateColumns = 'minmax(0, 1fr)';
      element.textContent = option.label;
      const entry = {option, element};
      element.addEventListener('mousedown', (event) => event.preventDefault());
      element.addEventListener('click', () => this.choose(entry));
      this.list.append(element);
      return entry;
    });
    this.setActive(-1);
  }

  public setDisabled(disabled: boolean) {
    this.input.contentEditable = String(!disabled);
    this.input.tabIndex = disabled ? -1 : 0;
    this.input.setAttribute('aria-disabled', String(disabled));
    if(disabled) this.hidePicker();
  }

  private visible() { return this.entries.filter(({element}) => !element.hidden); }

  private filter(query: string) {
    const matches = this.entries.filter(({option}) => option.matches(query));
    this.entries.forEach((entry) => {
      entry.element.hidden = !matches.includes(entry);
      entry.element.style.display = entry.element.hidden ? 'none' : '';
    });
    this.setActive(-1);
  }

  private setActive(index: number) {
    this.active = index;
    const active = this.visible()[index]?.element;
    this.entries.forEach(({element}) => {
      element.classList.toggle('active', element === active);
      element.setAttribute('aria-selected', String(element === active));
    });
    if(active) this.input.setAttribute('aria-activedescendant', active.id);
    else this.input.removeAttribute('aria-activedescendant');
  }

  private choose(entry: typeof this.entries[number]) {
    this.setValueSilently(entry.option.label);
    this.hidePicker();
    this.onSelect(entry.option.value);
  }

  private showPicker = () => {
    if(this.navigation || this.input.getAttribute('aria-disabled') === 'true') return;
    clearTimeout(this.hideTimeout);
    this.entries.forEach(({element}) => { element.hidden = false; element.style.display = ''; });
    this.setActive(-1);
    this.wrapper.inert = false;
    this.wrapper.classList.remove('hide');
    void this.wrapper.offsetWidth;
    this.wrapper.classList.add('active');
    this.input.setAttribute('aria-expanded', 'true');
    this.navigation = {type: 'autocomplete-helper', onPop: () => this.hidePicker()};
    appNavigationController.pushItem(this.navigation);
    this.document = this.input.ownerDocument;
    this.document.addEventListener('mousedown', this.onOutside, true);
    this.select();
  };

  private onOutside = (event: MouseEvent) => {
    if(!this.container.contains(event.target as Node)) this.hidePicker();
  };

  public hidePicker = () => {
    if(this.navigation) appNavigationController.removeItem(this.navigation);
    this.navigation = undefined;
    this.document.removeEventListener('mousedown', this.onOutside, true);
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
    this.wrapper.inert = true;
    this.wrapper.classList.remove('active');
    clearTimeout(this.hideTimeout);
    this.hideTimeout = window.setTimeout(() => this.wrapper.classList.add('hide'), 200);
  };

  public destroy() {
    this.hidePicker();
    clearTimeout(this.hideTimeout);
    this.scroll.destroy();
  }
}

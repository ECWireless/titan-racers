export type EditorCommand<T> = {
  apply: (current: T) => T;
  label: string;
  revert: (current: T) => T;
};

export class CommandHistory<T> {
  private cleanIndex = 0;
  private commands: EditorCommand<T>[] = [];
  private index = 0;
  private loadedValue: T;
  private readonly maxCommands: number;
  private value: T;

  constructor(loadedValue: T, maxCommands = 100) {
    if (!Number.isInteger(maxCommands) || maxCommands < 1) {
      throw new Error("Command history limit must be a positive integer.");
    }

    this.loadedValue = loadedValue;
    this.maxCommands = maxCommands;
    this.value = loadedValue;
  }

  get canRedo() {
    return this.index < this.commands.length;
  }

  get canUndo() {
    return this.index > 0;
  }

  get current() {
    return this.value;
  }

  get isDirty() {
    return this.cleanIndex < 0 || this.index !== this.cleanIndex;
  }

  execute(command: EditorCommand<T>) {
    if (this.index < this.commands.length) {
      this.commands.splice(this.index);

      if (this.cleanIndex > this.index) {
        this.cleanIndex = -1;
      }
    }

    this.value = command.apply(this.value);
    this.commands.push(command);
    this.index += 1;
    const overflow = this.commands.length - this.maxCommands;
    if (overflow > 0) {
      this.commands.splice(0, overflow);
      this.index -= overflow;
      this.cleanIndex =
        this.cleanIndex < overflow ? -1 : this.cleanIndex - overflow;
    }

    return this.value;
  }

  markClean() {
    this.cleanIndex = this.index;
    this.loadedValue = this.value;
  }

  redo() {
    const command = this.commands[this.index];
    if (!command) {
      return this.value;
    }

    this.value = command.apply(this.value);
    this.index += 1;

    return this.value;
  }

  reload(loadedValue: T) {
    this.commands = [];
    this.index = 0;
    this.cleanIndex = 0;
    this.loadedValue = loadedValue;
    this.value = loadedValue;

    return this.value;
  }

  resetToLoaded() {
    this.commands = [];
    this.index = 0;
    this.cleanIndex = 0;
    this.value = this.loadedValue;

    return this.value;
  }

  undo() {
    const command = this.commands[this.index - 1];
    if (!command) {
      return this.value;
    }

    this.value = command.revert(this.value);
    this.index -= 1;

    return this.value;
  }
}

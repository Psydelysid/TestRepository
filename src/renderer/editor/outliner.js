// Left-hand list of top-level world objects.
export class Outliner {
  constructor(editor, root) {
    this.editor = editor;
    this.root = root;
    editor.addEventListener('sceneChanged', () => this.render());
    editor.addEventListener('selectionChanged', () => this.updateSelection());
    this.render();
  }

  render() {
    this.root.replaceChildren();
    const children = this.editor.world.children;
    if (!children.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Empty world – add something!';
      this.root.append(li);
      return;
    }
    for (const object of children) {
      const li = document.createElement('li');
      li.dataset.uuid = object.uuid;
      li.classList.toggle('hidden', !object.visible);
      const icon = document.createElement('span');
      icon.className = 'icon';
      icon.textContent = iconFor(object);
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = object.name || object.type;
      const eye = document.createElement('button');
      eye.className = 'eye';
      eye.title = 'Toggle visibility';
      eye.textContent = object.visible ? '👁' : '–';
      eye.addEventListener('click', (e) => {
        e.stopPropagation();
        const before = object.visible;
        this.editor.change('Visibility', (v) => { object.visible = v; this.render(); }, before, !before);
      });
      li.append(icon, name, eye);
      li.addEventListener('click', () => this.editor.select(object));
      li.addEventListener('dblclick', () => this.editor.focus(object));
      this.root.append(li);
    }
    this.updateSelection();
  }

  updateSelection() {
    const uuid = this.editor.selected?.uuid;
    for (const li of this.root.children) {
      const on = li.dataset.uuid === uuid;
      li.classList.toggle('selected', on);
      if (on) li.scrollIntoView({ block: 'nearest' });
    }
  }
}

function iconFor(o) {
  if (o.userData.kind === 'scan') return '📷';
  if (o.userData.kind === 'terrain') return '⛰';
  if (o.isLight) return '💡';
  if (o.isPoints) return '⁘';
  if (o.isGroup) return '▣';
  return '◼';
}

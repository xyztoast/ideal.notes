(() => {
  'use strict';

  const NOTES_KEY = 'noted.notes.v1';
  const SETTINGS_KEY = 'noted.settings.v1';
  const ROUTES = new Set(['new', 'notes', 'settings']);
  const DEFAULT_SHORTCUTS = {
    newNote: 'Ctrl+Alt+N',
    bold: 'Ctrl+B',
    italic: 'Ctrl+I',
    underline: 'Ctrl+U',
    strikethrough: 'Ctrl+Shift+X',
    undo: 'Ctrl+Z',
    redo: 'Ctrl+Y',
    save: 'Ctrl+S',
    find: 'Ctrl+F'
  };
  const SHORTCUT_NAMES = {
    newNote: 'Create a new note',
    bold: 'Bold',
    italic: 'Italic',
    underline: 'Underline',
    strikethrough: 'Strikethrough',
    undo: 'Undo',
    redo: 'Redo',
    save: 'Save note',
    find: 'Find notes'
  };
  const ALLOWED_TAGS = new Set(['P', 'DIV', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'H2', 'H3', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'CODE', 'PRE', 'A']);

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const editorPage = $('.editor-page');
  const notesPage = $('#notes-page');
  const settingsPage = $('#settings-page');
  const editor = $('#note-editor');
  const titleInput = $('#note-title');
  const tagsInput = $('#note-tags');
  const placeholder = $('#editor-placeholder');
  const toastElement = $('#toast');

  let notes = readStorage(NOTES_KEY, []);
  const storedSettings = readStorage(SETTINGS_KEY, {});
  if (!Array.isArray(notes)) notes = [];
  let settings = {
    markdownTags: Boolean(storedSettings && storedSettings.markdownTags),
    shortcuts: { ...DEFAULT_SHORTCUTS, ...(storedSettings && storedSettings.shortcuts ? storedSettings.shortcuts : {}) },
    startupPage: ['new', 'notes', 'settings'].includes(storedSettings && storedSettings.startupPage) ? storedSettings.startupPage : 'new',
    showSidebarNotes: storedSettings && typeof storedSettings.showSidebarNotes === 'boolean' ? storedSettings.showSidebarNotes : true,
    backgroundHue: Number.isFinite(Number(storedSettings && storedSettings.backgroundHue)) ? Math.max(-120, Math.min(120, Number(storedSettings.backgroundHue))) : 0,
    whiteNoteText: storedSettings && typeof storedSettings.whiteNoteText === 'boolean' ? storedSettings.whiteNoteText : true
  };
  // Older versions stored a blank note as soon as the app opened. Drop those placeholders.
  notes = notes.filter(note => note && isMeaningfulNote(note));
  // Migrate the previous default away from Chrome's reserved Ctrl+N new-window command.
  if (String(settings.shortcuts.newNote).toLowerCase() === 'ctrl+n') {
    settings.shortcuts.newNote = DEFAULT_SHORTCUTS.newNote;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) { /* Settings can still run in memory. */ }
  }
  let activeNoteId = null;
  let draftNote = null;
  let currentRoute = routeFromPath(location.pathname) || settings.startupPage;
  let pendingConfirmAction = null;
  let recordingShortcut = null;
  let toastTimer = null;

  function readStorage(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      console.warn(`Could not read ${key} from localStorage.`, error);
      return fallback;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      showToast('This browser could not save your changes.');
      console.warn(`Could not write ${key} to localStorage.`, error);
      return false;
    }
  }

  function getBasePath(pathname) {
    const clean = pathname.replace(/\/+$/, '');
    if (!clean) return '';
    if (clean.endsWith('/index.html')) return clean.slice(0, -11);
    const pieces = clean.split('/').filter(Boolean);
    if (ROUTES.has(pieces[pieces.length - 1])) pieces.pop();
    return pieces.length ? `/${pieces.join('/')}` : '';
  }

  const basePath = getBasePath(location.pathname);

  function routeFromPath(pathname) {
    const last = pathname.replace(/\/+$/, '').split('/').filter(Boolean).pop();
    return ROUTES.has(last) ? last : null;
  }

  function routeUrl(route, noteId = null) {
    const path = `${basePath}/${route}`.replace(/\/+/g, '/');
    return noteId ? `${path}?id=${encodeURIComponent(noteId)}` : path;
  }

  function makeId() {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function makeDraftNote() {
    const now = Date.now();
    return { id: makeId(), title: '', content: '', tags: [], createdAt: now, updatedAt: now };
  }

  function createNote(navigate = true) {
    if (currentRoute === 'new') saveCurrentNote();
    draftNote = makeDraftNote();
    activeNoteId = draftNote.id;
    if (navigate) navigateTo('new', draftNote.id, false, true);
    else renderApp();
    return draftNote;
  }

  function persistNotes() {
    notes.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    writeStorage(NOTES_KEY, notes);
    renderSidebarNotes();
  }

  function persistSettings() {
    writeStorage(SETTINGS_KEY, settings);
  }

  function getActiveNote() {
    return notes.find(note => note.id === activeNoteId)
      || (draftNote && draftNote.id === activeNoteId ? draftNote : null);
  }

  function isMeaningfulNote(note) {
    return Boolean(
      String(note.title || '').trim()
      || plainText(note.content || '').trim()
      || (Array.isArray(note.tags) && note.tags.some(tag => String(tag).trim()))
    );
  }

  function applyAppearanceSettings() {
    document.documentElement.style.setProperty('--wallpaper-hue-shift', `${settings.backgroundHue}deg`);
    editorPage.classList.toggle('white-note-text', settings.whiteNoteText);
    $('#sidebar-notes-section').classList.toggle('hidden', !settings.showSidebarNotes);
  }

  function sanitizeHtml(html) {
    if (!html) return '';
    const parsed = new DOMParser().parseFromString(String(html), 'text/html');
    const output = document.createElement('div');
    const copyNode = (source, target) => {
      if (source.nodeType === Node.TEXT_NODE) {
        target.append(document.createTextNode(source.textContent || ''));
        return;
      }
      if (source.nodeType !== Node.ELEMENT_NODE) return;
      const tag = source.tagName.toUpperCase();
      if (!ALLOWED_TAGS.has(tag)) {
        [...source.childNodes].forEach(child => copyNode(child, target));
        return;
      }
      const element = document.createElement(tag.toLowerCase());
      if (tag === 'A') {
        const href = source.getAttribute('href') || '';
        try {
          const parsedUrl = new URL(href, location.origin);
          if (['http:', 'https:', 'mailto:'].includes(parsedUrl.protocol)) {
            element.setAttribute('href', parsedUrl.href);
            element.setAttribute('target', '_blank');
            element.setAttribute('rel', 'noopener noreferrer');
          }
        } catch (_) { /* Keep unsafe or malformed links as plain text. */ }
      }
      [...source.childNodes].forEach(child => copyNode(child, element));
      target.append(element);
    };
    [...parsed.body.childNodes].forEach(node => copyNode(node, output));
    return output.innerHTML;
  }

  function saveCurrentNote(showSaved = false) {
    const note = getActiveNote();
    if (!note || currentRoute !== 'new') return;
    const nextTitle = titleInput.value.trim();
    const nextContent = sanitizeHtml(editor.innerHTML);
    const nextTags = tagsInput.value.split(',').map(tag => tag.trim().replace(/^#/, '')).filter(Boolean).slice(0, 12);
    const changed = note.title !== nextTitle || note.content !== nextContent || JSON.stringify(note.tags || []) !== JSON.stringify(nextTags);
    if (!changed) return;
    note.title = nextTitle;
    note.content = nextContent;
    note.tags = nextTags;
    note.updatedAt = Date.now();

    if (draftNote && draftNote.id === note.id) {
      if (isMeaningfulNote(note)) {
        notes.unshift(note);
        draftNote = null;
        persistNotes();
      }
    } else {
      persistNotes();
    }

    $('#delete-note-button').hidden = !notes.some(item => item.id === note.id);
    renderWordCount();
    if (showSaved && notes.some(item => item.id === note.id)) showToast('saved');
  }

  function navigateTo(route, noteId = null, replace = false, skipSave = false) {
    if (!ROUTES.has(route)) route = 'new';
    if (currentRoute === 'new' && !skipSave) saveCurrentNote();
    currentRoute = route;
    if (noteId) activeNoteId = noteId;
    const url = routeUrl(route, route === 'new' ? (noteId || activeNoteId) : null);
    if (replace) history.replaceState({ route, noteId }, '', url);
    else history.pushState({ route, noteId }, '', url);
    renderApp();
  }

  function setActiveNote(id) {
    const note = notes.find(item => item.id === id);
    if (!note) return;
    if (currentRoute === 'new') saveCurrentNote();
    activeNoteId = note.id;
    navigateTo('new', note.id, false, true);
  }

  function renderApp() {
    let activePage;
    if (currentRoute === 'new') {
      if (!getActiveNote()) {
        const existingId = new URLSearchParams(location.search).get('id');
        const match = existingId && notes.find(note => note.id === existingId);
        activeNoteId = match ? match.id : (notes[0] ? notes[0].id : null);
        if (!activeNoteId) {
          draftNote = makeDraftNote();
          activeNoteId = draftNote.id;
        }
      }
      editorPage.classList.remove('hidden');
      notesPage.classList.add('hidden');
      settingsPage.classList.add('hidden');
      renderEditor();
      activePage = editorPage;
    } else if (currentRoute === 'notes') {
      editorPage.classList.add('hidden');
      notesPage.classList.remove('hidden');
      settingsPage.classList.add('hidden');
      renderNotes();
      activePage = notesPage;
    } else {
      editorPage.classList.add('hidden');
      notesPage.classList.add('hidden');
      settingsPage.classList.remove('hidden');
      renderSettings();
      activePage = settingsPage;
    }
    updateNavigation();
    applyAppearanceSettings();
    renderSidebarNotes();
    activePage.classList.remove('page-enter');
    requestAnimationFrame(() => activePage.classList.add('page-enter'));
  }

  function renderEditor() {
    const note = getActiveNote();
    if (!note) return;
    titleInput.value = note.title || '';
    tagsInput.value = (note.tags || []).join(', ');
    editor.innerHTML = sanitizeHtml(note.content || '');
    placeholder.classList.toggle('hidden', editor.textContent.trim().length > 0);
    renderWordCount();
    $('#delete-note-button').hidden = !notes.some(item => item.id === note.id);
    const url = routeUrl('new', note.id);
    if (location.pathname + location.search !== url) history.replaceState({ route: 'new', noteId: note.id }, '', url);
  }

  function updateNavigation() {
    $$('[data-route]').forEach(link => {
      const active = link.dataset.route === currentRoute;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function renderSidebarNotes() {
    const section = $('#sidebar-notes-section');
    const list = $('#sidebar-notes-list');
    if (!section || !list) return;
    section.classList.toggle('hidden', !settings.showSidebarNotes);
    list.replaceChildren();
    for (const note of notes) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `sidebar-note-link${activeNoteId === note.id && currentRoute === 'new' ? ' active' : ''}`;
      item.textContent = note.title.trim() || 'Untitled note';
      item.title = item.textContent;
      item.setAttribute('aria-label', `Open ${item.textContent}`);
      item.addEventListener('click', () => setActiveNote(note.id));
      list.append(item);
    }
  }


  function plainText(html) {
    const container = document.createElement('div');
    container.innerHTML = sanitizeHtml(html || '');
    return (container.innerText || container.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function noteTags(note) {
    const tags = new Set((note.tags || []).map(tag => String(tag).trim().replace(/^#/, '')).filter(Boolean));
    if (settings.markdownTags) {
      const text = `${note.title || ''} ${plainText(note.content || '')}`;
      const matches = text.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]{1,24})/gu);
      for (const match of matches) tags.add(match[1]);
    }
    return [...tags].slice(0, 5);
  }


  function renderNotes() {
    const grid = $('#notes-grid');
    const query = $('#notes-search').value.trim().toLowerCase();
    const results = notes.filter(note => {
      const text = `${note.title || ''} ${plainText(note.content || '')} ${noteTags(note).join(' ')}`.toLowerCase();
      return text.includes(query);
    }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    grid.replaceChildren();
    $('#notes-summary').textContent = `${results.length} ${results.length === 1 ? 'note' : 'notes'}`;
    $('#empty-notes').classList.toggle('hidden', results.length > 0);
    grid.classList.toggle('hidden', results.length === 0);

    for (const note of results) {
      const card = document.createElement('article');
      card.className = 'note-card';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `Open ${note.title || 'Untitled note'}`);
      const top = document.createElement('div');
      top.className = 'note-card-top';
      const remove = document.createElement('button');
      remove.className = 'note-card-delete';
      remove.type = 'button';
      remove.title = 'Delete note';
      remove.setAttribute('aria-label', 'Delete note');
      remove.textContent = 'delete';
      remove.addEventListener('click', event => {
        event.stopPropagation();
        confirmDeleteNote(note.id);
      });
      top.append(remove);
      const heading = document.createElement('h3');
      heading.textContent = note.title.trim() || 'Untitled note';
      const preview = document.createElement('p');
      preview.className = 'note-card-preview';
      preview.textContent = plainText(note.content);
      const chips = document.createElement('div');
      chips.className = 'note-card-tags';
      noteTags(note).forEach(tag => {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.textContent = `#${tag}`;
        chips.append(chip);
      });
      card.append(top, heading, preview, chips);
      card.addEventListener('click', () => setActiveNote(note.id));
      card.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setActiveNote(note.id);
        }
      });
      grid.append(card);
    }
  }

  function renderSettings() {
    $('#markdown-tags-setting').checked = settings.markdownTags;
    $('#startup-page-setting').value = settings.startupPage;
    $('#background-hue-setting').value = String(settings.backgroundHue);
    $('#background-hue-value').textContent = `${settings.backgroundHue}°`;
    $('#white-note-text-setting').checked = settings.whiteNoteText;
    $('#show-sidebar-notes-setting').checked = settings.showSidebarNotes;
    const list = $('#shortcut-list');
    list.replaceChildren();
    Object.entries(SHORTCUT_NAMES).forEach(([action, label]) => {
      const row = document.createElement('div');
      row.className = 'shortcut-row';
      const name = document.createElement('span');
      name.className = 'shortcut-name';
      name.textContent = label;
      const key = document.createElement('button');
      key.type = 'button';
      key.className = `shortcut-key${recordingShortcut === action ? ' recording' : ''}`;
      key.textContent = recordingShortcut === action ? 'press keys…' : settings.shortcuts[action];
      key.setAttribute('aria-label', `Change shortcut for ${label}`);
      key.addEventListener('click', () => {
        recordingShortcut = action;
        $('#shortcut-edit-status').textContent = 'press a key combination · esc to cancel';
        renderSettings();
      });
      row.append(name, key);
      list.append(row);
    });
  }

  function renderWordCount() {
    const text = (editor.innerText || '').trim();
    const count = text ? text.split(/\s+/).length : 0;
    $('#word-count').textContent = `${count} ${count === 1 ? 'word' : 'words'}`;
    placeholder.classList.toggle('hidden', text.length > 0);
  }

  function execFormat(command, value = null) {
    editor.focus();
    try {
      document.execCommand(command, false, value);
    } catch (error) {
      console.warn(`The ${command} formatting command was unavailable.`, error);
    }
    saveCurrentNote();
    renderWordCount();
  }

  function showToast(message) {
    toastElement.textContent = message;
    toastElement.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastElement.classList.remove('show'), 2300);
  }

  function showConfirm(title, message, action) {
    $('#confirm-title').textContent = title;
    $('#confirm-message').textContent = message;
    pendingConfirmAction = action;
    $('#confirm-modal').classList.remove('hidden');
    $('#accept-confirm').focus();
  }

  function closeConfirm() {
    $('#confirm-modal').classList.add('hidden');
    pendingConfirmAction = null;
  }

  function confirmDeleteNote(id) {
    const note = notes.find(item => item.id === id);
    if (!note) return;
    showConfirm('Delete this note?', `“${note.title.trim() || 'Untitled note'}” will be removed from this browser.`, () => {
      const wasActive = activeNoteId === id;
      notes = notes.filter(item => item.id !== id);
      persistNotes();
      if (wasActive) {
        activeNoteId = notes[0] ? notes[0].id : null;
        draftNote = null;
        if (currentRoute === 'new' && !activeNoteId) createNote(false);
      }
      closeConfirm();
      renderApp();
      showToast('note deleted');
    });
  }

  function deleteAllNotes() {
    showConfirm('Delete every note?', 'This removes all notepads saved in this browser. This cannot be undone.', () => {
      notes = [];
      activeNoteId = null;
      draftNote = null;
      persistNotes();
      if (currentRoute === 'new') {
        currentRoute = 'notes';
        history.pushState({ route: 'notes' }, '', routeUrl('notes'));
      }
      closeConfirm();
      renderApp();
      showToast('all notes deleted');
    });
  }

  function eventShortcut(event) {
    if (event.key === 'Escape') return 'Escape';
    const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
    const parts = [];
    if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey && !['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) parts.push('Shift');
    if (!['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) parts.push(key);
    return parts.join('+');
  }

  function handleShortcut(action) {
    switch (action) {
      case 'newNote': createNote(true); break;
      case 'bold': execFormat('bold'); break;
      case 'italic': execFormat('italic'); break;
      case 'underline': execFormat('underline'); break;
      case 'strikethrough': execFormat('strikeThrough'); break;
      case 'undo': execFormat('undo'); break;
      case 'redo': execFormat('redo'); break;
      case 'save': saveCurrentNote(true); break;
      case 'find':
        if (currentRoute !== 'notes') navigateTo('notes');
        $('#notes-search').focus();
        break;
    }
  }

  document.addEventListener('keydown', event => {
    if (recordingShortcut) {
      if (event.key === 'Escape') {
        event.preventDefault();
        recordingShortcut = null;
        $('#shortcut-edit-status').textContent = ''; 
        renderSettings();
        return;
      }
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
      event.preventDefault();
      const combination = eventShortcut(event);
      if (!combination.includes('+')) {
        $('#shortcut-edit-status').textContent = 'use ctrl, alt, or shift with a key';
        return;
      }
      if (combination.toLowerCase() === 'ctrl+n') {
        $('#shortcut-edit-status').textContent = 'chrome reserves ctrl+n for a new window; use ctrl+alt+n instead';
        return;
      }
      const duplicate = Object.entries(settings.shortcuts).find(([key, value]) => key !== recordingShortcut && value.toLowerCase() === combination.toLowerCase());
      if (duplicate) {
        $('#shortcut-edit-status').textContent = `already used for ${SHORTCUT_NAMES[duplicate[0]].toLowerCase()}`;
        return;
      }
      settings.shortcuts[recordingShortcut] = combination;
      recordingShortcut = null;
      persistSettings();
      $('#shortcut-edit-status').textContent = 'shortcut updated';
      renderSettings();
      showToast('shortcut updated');
      return;
    }

    const target = event.target;
    const isTypingInput = target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable);
    const combination = eventShortcut(event).toLowerCase();
    const action = Object.entries(settings.shortcuts).find(([, value]) => String(value).toLowerCase() === combination)?.[0];
    if (!action) return;

    // Browser-reserved shortcuts such as Ctrl+N cannot be intercepted by a webpage.
    // Use an app-safe default (Ctrl+Alt+N) and prevent browser/editor defaults for app shortcuts.
    const editorOnly = ['bold', 'italic', 'underline', 'strikethrough', 'undo', 'redo'];
    const shouldRun = !(editorOnly.includes(action) && currentRoute !== 'new')
      && !(isTypingInput && target !== editor && editorOnly.includes(action))
      && !(action === 'save' && currentRoute !== 'new');

    // Once a key combo belongs to the app, do not let the browser run its own action.
    event.preventDefault();
    event.stopPropagation();
    if (shouldRun) handleShortcut(action);
  });

  // Keep the cursor in the writing area when the user presses Ctrl+Enter.
  document.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && currentRoute === 'new') {
      event.preventDefault();
      editor.focus();
    }
  });

  document.addEventListener('click', event => {
    const link = event.target.closest('[data-route]');
    if (!link) return;
    event.preventDefault();
    const route = link.dataset.route;
    if (route === 'new') createNote(true);
    else navigateTo(route);
  });

  window.addEventListener('popstate', () => {
    if (currentRoute === 'new') saveCurrentNote();
    currentRoute = routeFromPath(location.pathname) || settings.startupPage;
    if (currentRoute === 'new') {
      const id = new URLSearchParams(location.search).get('id');
      activeNoteId = notes.some(note => note.id === id) ? id : (notes[0]?.id || null);
      if (!activeNoteId) {
        draftNote = makeDraftNote();
        activeNoteId = draftNote.id;
      }
    }
    renderApp();
  });

  $$('.format-button').forEach(button => {
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => {
      const command = button.dataset.command;
      const value = button.dataset.value || null;
      execFormat(command, value);
    });
  });

  titleInput.addEventListener('input', () => {
    saveCurrentNote();
  });
  tagsInput.addEventListener('input', saveCurrentNote);
  editor.addEventListener('input', () => {
    renderWordCount();
    saveCurrentNote();
  });
  editor.addEventListener('paste', event => {
    event.preventDefault();
    const text = (event.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  });

  $('#notes-create-button').addEventListener('click', () => createNote(true));
  $('#empty-create-button').addEventListener('click', () => createNote(true));
  $('#notes-search').addEventListener('input', renderNotes);
  $('#delete-note-button').addEventListener('click', () => {
    const note = getActiveNote();
    if (note) confirmDeleteNote(note.id);
  });
  $('#markdown-tags-setting').addEventListener('change', event => {
    settings.markdownTags = event.target.checked;
    persistSettings();
    showToast(settings.markdownTags ? 'markdown tags enabled' : 'markdown tags disabled');
  });
  $('#startup-page-setting').addEventListener('change', event => {
    settings.startupPage = ['new', 'notes', 'settings'].includes(event.target.value) ? event.target.value : 'new';
    persistSettings();
    showToast('startup page updated');
  });
  $('#background-hue-setting').addEventListener('input', event => {
    settings.backgroundHue = Math.max(-120, Math.min(120, Number(event.target.value) || 0));
    $('#background-hue-value').textContent = `${settings.backgroundHue}°`;
    applyAppearanceSettings();
    persistSettings();
  });
  $('#white-note-text-setting').addEventListener('change', event => {
    settings.whiteNoteText = event.target.checked;
    applyAppearanceSettings();
    persistSettings();
  });
  $('#show-sidebar-notes-setting').addEventListener('change', event => {
    settings.showSidebarNotes = event.target.checked;
    applyAppearanceSettings();
    renderSidebarNotes();
    persistSettings();
  });
  $('#delete-all-button').addEventListener('click', deleteAllNotes);
  $('#reset-shortcuts').addEventListener('click', () => {
    settings.shortcuts = { ...DEFAULT_SHORTCUTS };
    recordingShortcut = null;
    persistSettings();
    renderSettings();
    showToast('default shortcuts restored');
  });
  $('#cancel-confirm').addEventListener('click', closeConfirm);
  $('#accept-confirm').addEventListener('click', () => {
    if (pendingConfirmAction) pendingConfirmAction();
  });
  $('#confirm-modal').addEventListener('click', event => {
    if (event.target === $('#confirm-modal')) closeConfirm();
  });

  // A route may have been opened directly, or restored by the GitHub Pages fallback.
  const initialId = new URLSearchParams(location.search).get('id');
  if (currentRoute === 'new') {
    activeNoteId = notes.some(note => note.id === initialId) ? initialId : (notes[0]?.id || null);
    if (!activeNoteId) {
      draftNote = makeDraftNote();
      activeNoteId = draftNote.id;
    }
  }
  if (!routeFromPath(location.pathname)) {
    history.replaceState({ route: currentRoute, noteId: currentRoute === 'new' ? activeNoteId : null }, '', routeUrl(currentRoute, currentRoute === 'new' ? activeNoteId : null));
  }
  const storedNotes = readStorage(NOTES_KEY, []);
  if (!Array.isArray(storedNotes) || notes.length !== storedNotes.length) persistNotes();
  renderApp();
})();

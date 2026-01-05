// --- 数据管理 ---

let db = { categories: [], notes: [] };
const API_URL = './api.php';

const DEFAULT_CATEGORY_ID = 'all';
const UNCATEGORIZED_CATEGORY_ID = 'uncategorized';
const PRIVATE_CATEGORY_ID = 'private';
const TRASH_CATEGORY_ID = 'trash';

// 初始化数据库并做旧数据兜底
async function initializeDB() {
    try {
        const data = await apiRequest('bootstrap', null, 'GET');
        db.categories = data.categories || [];
        db.notes = data.notes || [];
    } catch (e) {
        console.error('Failed to load from server, using defaults', e);
        alert('从服务器加载数据失败，已使用本地默认数据。请检查 api.php 和 note.db 权限。');
        db.categories = [
            { id: DEFAULT_CATEGORY_ID, name: '全部笔记', notes: [] },
            { id: UNCATEGORIZED_CATEGORY_ID, name: '未分类', notes: [] },
            { id: PRIVATE_CATEGORY_ID, name: '私密笔记', notes: [] },
            { id: TRASH_CATEGORY_ID, name: '最近删除', notes: [] }
        ];
        db.notes = [];
    }

    ensureDefaultCategories();
    normalizeNotes();
    rebuildCategoryRefs();
}

function ensureDefaultCategories() {
    const hasAll = db.categories.some(cat => cat.id === DEFAULT_CATEGORY_ID);
    const hasUncategorized = db.categories.some(cat => cat.id === UNCATEGORIZED_CATEGORY_ID);
    const hasPrivate = db.categories.some(cat => cat.id === PRIVATE_CATEGORY_ID);
    const hasTrash = db.categories.some(cat => cat.id === TRASH_CATEGORY_ID);
    if (!hasAll) db.categories.unshift({ id: DEFAULT_CATEGORY_ID, name: '全部笔记', notes: [] });
    if (!hasUncategorized) db.categories.push({ id: UNCATEGORIZED_CATEGORY_ID, name: '未分类', notes: [] });
    if (!hasPrivate) db.categories.push({ id: PRIVATE_CATEGORY_ID, name: '私密笔记', notes: [] });
    if (!hasTrash) db.categories.push({ id: TRASH_CATEGORY_ID, name: '最近删除', notes: [] });
}

function normalizeNotes() {
    db.notes = db.notes.map(note => {
        const safeCategory = note.categoryId || UNCATEGORIZED_CATEGORY_ID;
        const isDeleted = !!note.isDeleted || safeCategory === TRASH_CATEGORY_ID;
        const isPrivate = !!note.isPrivate || safeCategory === PRIVATE_CATEGORY_ID;
        const originalCategoryId = note.originalCategoryId || (safeCategory !== TRASH_CATEGORY_ID ? safeCategory : UNCATEGORIZED_CATEGORY_ID);
        return {
            ...note,
            categoryId: isDeleted ? TRASH_CATEGORY_ID : safeCategory,
            isDeleted,
            isPrivate,
            encrypted: note.encrypted || null,
            originalCategoryId,
            updatedAt: note.updatedAt || Date.parse(note.lastModified || '') || Date.now(),
            lastModified: note.lastModified || new Date().toLocaleString('zh-CN'),
            contentType: note.contentType || CONTENT_TYPES.PLAIN
        };
    });
}

function rebuildCategoryRefs() {
    db.categories.forEach(cat => { if (cat.id !== DEFAULT_CATEGORY_ID) cat.notes = []; });
    db.notes.forEach(note => {
        const target = db.categories.find(cat => cat.id === note.categoryId) || db.categories.find(cat => cat.id === UNCATEGORIZED_CATEGORY_ID);
        note.categoryId = target.id;
        if (!target.notes.includes(note.id)) target.notes.push(note.id);
    });
}

let syncQueue = Promise.resolve();
let syncErrorNotified = false;

async function apiRequest(action, payload = null, method = 'POST') {
    const options = { method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
    if (method !== 'GET') options.body = JSON.stringify(payload || {});
    const url = `${API_URL}?action=${encodeURIComponent(action)}`;
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.message || 'Server error');
    return json.data;
}

function saveToLocalStorage() {
    syncQueue = syncQueue.then(() => syncToServer()).catch(err => {
        console.error('Sync failed', err);
        if (!syncErrorNotified) {
            alert('同步到服务器失败，请检查服务器日志/数据库权限。');
            syncErrorNotified = true;
        }
    });
}

async function syncToServer() {
    await apiRequest('syncAll', { categories: db.categories, notes: db.notes });
}

// --- DOM 元素获取 ---

const searchInput = document.getElementById('searchInput');
const searchButton = document.getElementById('searchButton');
const clearSearchButton = document.getElementById('clearSearchButton');

const categoryList = document.getElementById('categoryList');
const addCategoryButtonFooter = document.getElementById('addCategoryButtonFooter');
const categoryCount = document.getElementById('categoryCount');

const currentCategoryTitle = document.getElementById('currentCategoryTitle');
const noteList = document.getElementById('noteList');
const noteListEmpty = document.getElementById('noteListEmpty');
const noteCountIndicator = document.getElementById('noteCountIndicator');
const sortSelect = document.getElementById('sortSelect');
const newNoteButton = document.getElementById('newNoteButton');
const renameCategoryButton = document.getElementById('renameCategoryButton');
const deleteCategoryButton = document.getElementById('deleteCategoryButton');

const noteEditor = document.getElementById('noteEditor');
const emptyNoteHint = document.getElementById('emptyNoteHint');
const noteTitleInput = document.getElementById('noteTitleInput');
const noteContentInput = document.getElementById('noteContentInput');
const lastModifiedInfo = document.getElementById('lastModifiedInfo');
const noteCategorySelect = document.getElementById('noteCategorySelect');
const editorModeSelect = document.getElementById('editorModeSelect');
const privateToggle = document.getElementById('privateToggle');
const saveNoteButton = document.getElementById('saveNoteButton');
const deleteNoteButton = document.getElementById('deleteNoteButton');
const restoreNoteButton = document.getElementById('restoreNoteButton');
const themeToggle = document.getElementById('themeToggle');
const langSelect = document.getElementById('langSelect');
const richEditor = document.getElementById('richEditor');
const markdownPreview = document.getElementById('markdownPreview');

// --- 全局状态 ---

let currentCategoryId = DEFAULT_CATEGORY_ID;
let currentNoteId = null;
let currentLang = 'zh';
const unlockedSecrets = {};
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const CONTENT_TYPES = { PLAIN: 'plain', RICH: 'html', MD: 'markdown' };
let currentEditorMode = CONTENT_TYPES.PLAIN;
let quillEditor = null;

// --- 多语言 ---

const translations = {
    zh: {
        brandTitle: '笔记',
        brandSub: '102300429',
        groups: '我的分组',
        newCategory: '+ 新建分类',
        allNotes: '全部笔记',
        countSuffix: '条',
        searchPlaceholder: '搜索标题或内容...',
        search: '搜索',
        clear: '清空',
        sortModified: '按最新修改',
        sortTitle: '按标题 A-Z',
        sortCategory: '按分类',
        renameCategory: '重命名分类',
        deleteCategory: '删除分类',
        newNote: '+ 新建笔记',
        emptyList: '暂无笔记，点击“新建笔记”开始记录。',
        titlePlaceholder: '笔记标题',
        categoryLabel: '分类',
        lastModified: '最后修改时间',
        privateLabel: '私密',
        contentPlaceholder: '在这里输入笔记内容...',
        restore: '恢复',
        delete: '删除',
        save: '保存',
        editorMode: '编辑模式',
        modePlain: '纯文本',
        modeRich: '富文本',
        modeMarkdown: 'Markdown',
        emptyHint: '请选择左侧的笔记，或点击“新建笔记”开始创作。',
        modalMessage: '确认操作？',
        confirm: '确认',
        cancel: '取消',
        switchToLight: '切换到日间模式',
        switchToDark: '切换到夜间模式',
        defaultCategoryName: '未分类',
        allCategoryName: '全部笔记',
        privateCategoryName: '私密笔记',
        trashCategoryName: '最近删除',
        privateNote: '私密笔记',
        newNoteTitle: '新笔记',
        newPrivateNoteTitle: '新私密笔记',
        untitledNote: '无标题笔记',
        searchTitle: term => `搜索 "${term}"`,
        confirmDeleteCategory: name => `确定要删除分类 "${name}" 吗？该分类下的笔记将被移动到 "未分类"。`,
        promptNewCategory: '请输入新分类名称:',
        promptRenameCategory: '请输入新的分类名称:',
        alertEmptyCategory: '分类名称不能为空',
        alertDupCategory: '分类名称已存在',
        alertProtectedCategory: '该分类不可重命名',
        alertProtectedCategoryDelete: '不能删除默认分类！',
        alertEmptyTitle: '笔记标题不能为空！',
        alertDupNote: '同一分类下已存在相同标题的笔记',
        promptPrivatePassword: '请输入私密笔记访问密码',
        promptSetPassword: '请输入私密笔记密码',
        alertUnlockFailed: '密码错误，无法解锁',
        alertMissingEncrypted: '私密笔记缺少加密数据，无法解锁',
        alertCancelCreatePrivate: '未设置密码，已取消创建私密笔记',
        alertEncryptFail: '加密失败，已取消创建',
        alertEncryptFailSave: '加密失败，未保存',
        confirmDeleteNote: title => `确定要删除笔记 "${title}" 吗？`,
        confirmDeleteNotePermanent: '确定要永久删除该笔记吗？此操作不可恢复',
        privateLocked: '内容已加密'
    },
    en: {
        brandTitle: 'Notes',
        brandSub: '102300429',
        groups: 'My Groups',
        newCategory: '+ New Category',
        allNotes: 'All Notes',
        countSuffix: 'items',
        searchPlaceholder: 'Search title or content...',
        search: 'Search',
        clear: 'Clear',
        sortModified: 'Latest Modified',
        sortTitle: 'Title A-Z',
        sortCategory: 'By Category',
        renameCategory: 'Rename Category',
        deleteCategory: 'Delete Category',
        newNote: '+ New Note',
        emptyList: 'No notes. Click "New Note" to start.',
        titlePlaceholder: 'Note title',
        categoryLabel: 'Category',
        lastModified: 'Last Modified',
        privateLabel: 'Private',
        contentPlaceholder: 'Write your note here...',
        restore: 'Restore',
        delete: 'Delete',
        save: 'Save',
        editorMode: 'Editor Mode',
        modePlain: 'Plain Text',
        modeRich: 'Rich Text',
        modeMarkdown: 'Markdown',
        emptyHint: 'Select a note on the left or click "New Note" to start.',
        modalMessage: 'Confirm action?',
        confirm: 'Confirm',
        cancel: 'Cancel',
        switchToLight: 'Switch to light mode',
        switchToDark: 'Switch to dark mode',
        defaultCategoryName: 'Uncategorized',
        allCategoryName: 'All Notes',
        privateCategoryName: 'Private Notes',
        trashCategoryName: 'Recently Deleted',
        privateNote: 'Private Note',
        newNoteTitle: 'New Note',
        newPrivateNoteTitle: 'New Private Note',
        untitledNote: 'Untitled Note',
        searchTitle: term => `Search "${term}"`,
        confirmDeleteCategory: name => `Delete category "${name}"? Notes will move to "Uncategorized".`,
        promptNewCategory: 'Enter new category name:',
        promptRenameCategory: 'Enter new category name:',
        alertEmptyCategory: 'Category name cannot be empty',
        alertDupCategory: 'Category name already exists',
        alertProtectedCategory: 'This category cannot be renamed',
        alertProtectedCategoryDelete: 'Default categories cannot be deleted',
        alertEmptyTitle: 'Title cannot be empty!',
        alertDupNote: 'A note with the same title already exists in this category',
        promptPrivatePassword: 'Enter private note password',
        promptSetPassword: 'Set a password for the private note',
        alertUnlockFailed: 'Wrong password',
        alertMissingEncrypted: 'Missing encrypted data for this private note',
        alertCancelCreatePrivate: 'No password set. Private note creation canceled.',
        alertEncryptFail: 'Encryption failed. Creation canceled.',
        alertEncryptFailSave: 'Encryption failed. Not saved.',
        confirmDeleteNote: title => `Delete note "${title}"?`,
        confirmDeleteNotePermanent: 'Delete permanently? This cannot be undone.',
        privateLocked: 'Content is encrypted'
    }
};

function t(key, ...args) {
    const pack = translations[currentLang] || translations.zh;
    const value = pack[key];
    if (typeof value === 'function') return value(...args);
    return value ?? key;
}

function detectDefaultLang() {
    const saved = localStorage.getItem('noteLang');
    if (saved && translations[saved]) return saved;
    const nav = (navigator.language || navigator.userLanguage || '').toLowerCase();
    return nav.startsWith('zh') ? 'zh' : 'en';
}

function applyLangToSystemCategories() {
    db.categories = db.categories.map(cat => {
        if (cat.id === DEFAULT_CATEGORY_ID) return { ...cat, name: t('allCategoryName') };
        if (cat.id === UNCATEGORIZED_CATEGORY_ID) return { ...cat, name: t('defaultCategoryName') };
        if (cat.id === PRIVATE_CATEGORY_ID) return { ...cat, name: t('privateCategoryName') };
        if (cat.id === TRASH_CATEGORY_ID) return { ...cat, name: t('trashCategoryName') };
        return cat;
    });
}

function getCategoryDisplayName(categoryId) {
    if (categoryId === DEFAULT_CATEGORY_ID) return t('allCategoryName');
    if (categoryId === UNCATEGORIZED_CATEGORY_ID) return t('defaultCategoryName');
    if (categoryId === PRIVATE_CATEGORY_ID) return t('privateCategoryName');
    if (categoryId === TRASH_CATEGORY_ID) return t('trashCategoryName');
    return db.categories.find(cat => cat.id === categoryId)?.name || t('defaultCategoryName');
}

// --- 工具方法 ---

function formatDate(ts) {
    const d = new Date(ts || Date.now());
    const locale = currentLang === 'en' ? 'en-US' : 'zh-CN';
    return d.toLocaleString(locale);
}

function getSnippet(text, len = 60) {
    const clean = (text || '').replace(/\n+/g, ' ').trim();
    return clean.length > len ? clean.slice(0, len) + '...' : clean;
}

function getCategoryName(categoryId) {
    return getCategoryDisplayName(categoryId);
}

function stripHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html || '';
    return div.textContent || '';
}

function markdownToText(md) {
    try {
        const html = window.marked ? marked.parse(md || '') : (md || '');
        const safe = window.DOMPurify ? DOMPurify.sanitize(html) : html;
        return stripHtml(safe);
    } catch (e) {
        return md || '';
    }
}

function getContentText(content, type = CONTENT_TYPES.PLAIN) {
    if (type === CONTENT_TYPES.RICH) return stripHtml(content || '');
    if (type === CONTENT_TYPES.MD) return markdownToText(content || '');
    return content || '';
}

function populateCategorySelect(selectedId = UNCATEGORIZED_CATEGORY_ID) {
    noteCategorySelect.innerHTML = '';
    db.categories
        .filter(cat => ![DEFAULT_CATEGORY_ID, PRIVATE_CATEGORY_ID, TRASH_CATEGORY_ID].includes(cat.id))
        .forEach(cat => {
            const option = document.createElement('option');
            option.value = cat.id;
            option.textContent = cat.name;
            if (cat.id === selectedId) option.selected = true;
            noteCategorySelect.appendChild(option);
        });
}

function getSortedNotes(list) {
    const notes = [...list];
    const mode = sortSelect?.value || 'modified';
    if (mode === 'title') {
        const locale = currentLang === 'en' ? 'en' : 'zh-CN';
        notes.sort((a, b) => a.title.localeCompare(b.title, locale));
    } else if (mode === 'category') {
        const locale = currentLang === 'en' ? 'en' : 'zh-CN';
        notes.sort((a, b) => getCategoryName(a.categoryId).localeCompare(getCategoryName(b.categoryId), locale));
    } else {
        notes.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    }
    return notes;
}

function getActiveNotes() {
    return db.notes.filter(n => !n.isDeleted);
}

function initEditors() {
    if (window.Quill && richEditor) {
        quillEditor = new Quill(richEditor, {
            theme: 'snow',
            modules: {
                toolbar: [
                    [{ header: [1, 2, 3, false] }],
                    ['bold', 'italic', 'underline', 'strike'],
                    [{ color: [] }, { background: [] }],
                    [{ list: 'ordered' }, { list: 'bullet' }],
                    [{ indent: '-1' }, { indent: '+1' }],
                    ['blockquote', 'code-block'],
                    [{ align: [] }],
                    ['clean']
                ]
            }
        });
    }
    setEditorMode(CONTENT_TYPES.PLAIN, false);
}

function setEditorMode(mode, preserveValue = true) {
    const targetMode = mode || CONTENT_TYPES.PLAIN;
    if (preserveValue) {
        const existing = getEditorContent(currentEditorMode);
        applyEditorVisibility(targetMode);
        setEditorValue(existing, targetMode);
    } else {
        applyEditorVisibility(targetMode);
    }
    currentEditorMode = targetMode;
    if (editorModeSelect) editorModeSelect.value = targetMode;
    if (targetMode === CONTENT_TYPES.MD) renderMarkdownPreview(noteContentInput.value);
}

function applyEditorVisibility(mode) {
    if (!noteContentInput) return;
    const isRich = mode === CONTENT_TYPES.RICH;
    const isMd = mode === CONTENT_TYPES.MD;
    noteContentInput.style.display = isRich ? 'none' : 'block';
    if (richEditor) richEditor.style.display = isRich ? 'block' : 'none';
    if (markdownPreview) markdownPreview.style.display = isMd ? 'block' : 'none';
    if (quillEditor) quillEditor.enable(!noteContentInput.disabled);
}

function setEditorValue(value, mode = currentEditorMode) {
    if (mode === CONTENT_TYPES.RICH && quillEditor) {
        quillEditor.root.innerHTML = value || '';
    } else {
        noteContentInput.value = value || '';
        if (mode === CONTENT_TYPES.MD) renderMarkdownPreview(value || '');
    }
}

function getEditorContent(mode = currentEditorMode) {
    if (mode === CONTENT_TYPES.RICH && quillEditor) {
        return quillEditor.root.innerHTML || '';
    }
    return noteContentInput.value || '';
}

function renderMarkdownPreview(content) {
    if (!markdownPreview) return;
    try {
        const html = window.marked ? marked.parse(content || '') : (content || '');
        markdownPreview.innerHTML = window.DOMPurify ? DOMPurify.sanitize(html) : html;
    } catch (e) {
        markdownPreview.textContent = content || '';
    }
}

function bufToB64(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function b64ToBuf(b64) {
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
}

async function deriveKey(password, salt) {
    const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

async function encryptPayload(payload, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const data = encoder.encode(JSON.stringify(payload));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    return { cipher: bufToB64(cipher), iv: bufToB64(iv), salt: bufToB64(salt) };
}

async function decryptPayload(encrypted, password) {
    const salt = new Uint8Array(b64ToBuf(encrypted.salt));
    const iv = new Uint8Array(b64ToBuf(encrypted.iv));
    const key = await deriveKey(password, salt);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, b64ToBuf(encrypted.cipher));
    return JSON.parse(decoder.decode(plainBuf));
}

async function unlockPrivate(note) {
    if (!note.isPrivate) return null;
    if (unlockedSecrets[note.id]) return unlockedSecrets[note.id];
    if (!note.encrypted) {
        alert(t('alertMissingEncrypted'));
        return null;
    }
    const pwd = prompt(t('promptPrivatePassword'));
    if (!pwd) return null;
    try {
        const payload = await decryptPayload(note.encrypted, pwd);
        unlockedSecrets[note.id] = { ...payload, contentType: payload.contentType || CONTENT_TYPES.PLAIN, password: pwd };
        return unlockedSecrets[note.id];
    } catch (e) {
        alert(t('alertUnlockFailed'));
        return null;
    }
}

function validateCategoryName(name, excludeId = null) {
    const trimmed = (name || '').trim();
    if (!trimmed) {
        alert(t('alertEmptyCategory'));
        return null;
    }
    const exists = db.categories.find(cat => cat.name === trimmed && cat.id !== excludeId);
    if (exists) {
        alert(t('alertDupCategory'));
        return null;
    }
    return trimmed;
}

function isNoteTitleDuplicate(title, categoryId, excludeNoteId = null) {
    const trimmed = (title || '').trim();
    return db.notes.some(n => !n.isPrivate && !n.isDeleted && n.id !== excludeNoteId && n.categoryId === categoryId && n.title === trimmed);
}

function getUniqueTitle(baseTitle, categoryId) {
    let title = (baseTitle || t('newNoteTitle')).trim() || t('newNoteTitle');
    if (!isNoteTitleDuplicate(title, categoryId)) return title;
    let suffix = 2;
    while (isNoteTitleDuplicate(`${title} (${suffix})`, categoryId)) {
        suffix += 1;
    }
    return `${title} (${suffix})`;
}

function refreshSortOptions() {
    const categoryOption = sortSelect?.querySelector('option[value="category"]');
    if (!categoryOption || !sortSelect) return;
    if (currentCategoryId === DEFAULT_CATEGORY_ID) {
        categoryOption.disabled = false;
        categoryOption.hidden = false;
    } else {
        if (sortSelect.value === 'category') sortSelect.value = 'modified';
        categoryOption.disabled = true;
        categoryOption.hidden = true;
    }
}

// --- 主题 ---

function updateThemeToggleLabel(theme) {
    if (!themeToggle) return;
    const isDark = theme === 'dark';
    themeToggle.textContent = '';
    themeToggle.classList.toggle('is-dark', isDark);
    const label = isDark ? `${t('switchToLight') || '切换到日间模式'}` : `${t('switchToDark') || '切换到夜间模式'}`;
    themeToggle.setAttribute('aria-label', label);
    themeToggle.setAttribute('title', label);
}

function applyTheme(mode = 'light') {
    const theme = mode === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('noteTheme', theme);
    updateThemeToggleLabel(theme);
}

function initTheme() {
    const saved = localStorage.getItem('noteTheme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(saved || (prefersDark ? 'dark' : 'light'));
}

function applyTranslations() {
    document.documentElement.lang = currentLang === 'en' ? 'en' : 'zh-CN';
    document.title = currentLang === 'en' ? 'Personal Note Manager' : '个人笔记管理系统';

    const brandTitle = document.querySelector('.brand-title');
    const brandSub = document.querySelector('.brand-sub');
    const groupTitle = document.querySelector('.sidebar-title h2');
    const categoryLabel = document.querySelector('label[for="noteCategorySelect"]');
    const editorModeLabel = document.querySelector('label[for="editorModeSelect"]');
    const privateLabelText = document.getElementById('privateLabelText');
    const emptyHintText = document.querySelector('#emptyNoteHint p');
    const modalMessage = document.getElementById('modalMessage');

    if (brandTitle) brandTitle.textContent = t('brandTitle');
    if (brandSub) brandSub.textContent = t('brandSub');
    if (groupTitle) groupTitle.textContent = t('groups');
    addCategoryButtonFooter.textContent = t('newCategory');

    currentCategoryTitle.textContent = getCategoryDisplayName(currentCategoryId);
    noteListEmpty.textContent = t('emptyList');

    searchInput.placeholder = t('searchPlaceholder');
    searchButton.textContent = t('search');
    clearSearchButton.textContent = t('clear');
    sortSelect.querySelector('option[value="modified"]').textContent = t('sortModified');
    sortSelect.querySelector('option[value="title"]').textContent = t('sortTitle');
    sortSelect.querySelector('option[value="category"]').textContent = t('sortCategory');
    renameCategoryButton.textContent = t('renameCategory');
    deleteCategoryButton.textContent = t('deleteCategory');
    newNoteButton.textContent = t('newNote');

    noteTitleInput.placeholder = t('titlePlaceholder');
    if (categoryLabel) categoryLabel.textContent = t('categoryLabel');
    if (editorModeLabel) editorModeLabel.textContent = t('editorMode');
    if (privateLabelText) privateLabelText.textContent = ` ${t('privateLabel')}`;
    noteContentInput.placeholder = t('contentPlaceholder');
    restoreNoteButton.textContent = t('restore');
    deleteNoteButton.textContent = t('delete');
    saveNoteButton.textContent = t('save');
    if (editorModeSelect) {
        editorModeSelect.querySelector('option[value="plain"]').textContent = t('modePlain');
        editorModeSelect.querySelector('option[value="html"]').textContent = t('modeRich');
        editorModeSelect.querySelector('option[value="markdown"]').textContent = t('modeMarkdown');
    }
    lastModifiedInfo.textContent = `${t('lastModified')}: --`;

    if (emptyHintText) emptyHintText.textContent = t('emptyHint');
    if (modalMessage) modalMessage.textContent = t('modalMessage');
    document.getElementById('confirmModalButton').textContent = t('confirm');
    document.getElementById('cancelModalButton').textContent = t('cancel');

    if (langSelect) langSelect.value = currentLang;
}

function setLanguage(lang) {
    const next = translations[lang] ? lang : 'zh';
    currentLang = next;
    localStorage.setItem('noteLang', next);
    applyLangToSystemCategories();
    saveToLocalStorage();
    applyTranslations();
    renderCategoryList();
    renderNoteList();
    populateCategorySelect(noteCategorySelect.value);
    updateThemeToggleLabel(document.documentElement.getAttribute('data-theme') || 'light');
}

function initLanguage() {
    currentLang = detectDefaultLang();
    if (langSelect) langSelect.value = currentLang;
    document.documentElement.lang = currentLang === 'en' ? 'en' : 'zh-CN';
}

function relockPrivateNotes() {
    Object.keys(unlockedSecrets).forEach(id => delete unlockedSecrets[id]);
}

// --- 渲染 ---

function renderCategoryList() {
    categoryList.innerHTML = '';
    const visibleCategories = db.categories.filter(cat => cat.id !== DEFAULT_CATEGORY_ID);
    categoryCount.textContent = visibleCategories.length;

    const weighted = db.categories.map((cat, idx) => ({
        cat,
        order: cat.id === TRASH_CATEGORY_ID ? 99 : (cat.id === DEFAULT_CATEGORY_ID ? -1 : (cat.id === PRIVATE_CATEGORY_ID ? 90 : (cat.id === UNCATEGORIZED_CATEGORY_ID ? 0 : 1))),
        idx
    })).sort((a, b) => (a.order === b.order ? a.idx - b.idx : a.order - b.order));

    weighted.forEach(({ cat: category }) => {
        let noteCount = 0;
        if (category.id === DEFAULT_CATEGORY_ID) {
            noteCount = getActiveNotes().length;
        } else if (category.id === TRASH_CATEGORY_ID) {
            noteCount = db.notes.filter(n => n.isDeleted).length;
        } else if (category.id === PRIVATE_CATEGORY_ID) {
            noteCount = getActiveNotes().filter(n => n.isPrivate).length;
        } else {
            noteCount = getActiveNotes().filter(n => n.categoryId === category.id && !n.isPrivate).length;
        }
        const li = document.createElement('li');
        li.dataset.categoryId = category.id;
        const title = document.createElement('span');
        title.textContent = getCategoryDisplayName(category.id);
        const badge = document.createElement('span');
        badge.className = 'pill soft';
        badge.textContent = noteCount;
        li.appendChild(title);
        li.appendChild(badge);

        if (category.id === currentCategoryId) li.classList.add('active');

        li.addEventListener('click', () => selectCategory(category.id));
        categoryList.appendChild(li);
    });
}

function renderNoteList(notesOverride = null, keepTitle = false) {
    noteList.innerHTML = '';
    const rawNotes = notesOverride || getNotesForCurrentCategory();
    const notes = getSortedNotes(rawNotes);

    notes.forEach(note => {
        const li = document.createElement('li');
        li.dataset.noteId = note.id;
        if (note.id === currentNoteId) li.classList.add('active');

        const unlocked = note.isPrivate ? unlockedSecrets[note.id] : null;
        const title = note.isPrivate ? (unlocked?.title || t('privateNote')) : (note.title || t('untitledNote'));
        const contentType = note.isPrivate ? (unlocked?.contentType || CONTENT_TYPES.PLAIN) : (note.contentType || CONTENT_TYPES.PLAIN);
        const contentVal = note.isPrivate ? (unlocked?.content || '') : (note.content || '');
        const snippet = note.isPrivate
            ? (unlocked ? (getSnippet(getContentText(contentVal, contentType)) || t('contentPlaceholder')) : t('privateLocked'))
            : getSnippet(getContentText(contentVal, contentType));
        const tagText = note.isPrivate ? t('privateLabel') : (note.isDeleted ? t('trashCategoryName') : getCategoryName(note.categoryId));

        li.innerHTML = `
            <div class="note-title">${title}</div>
            <div class="note-snippet">${snippet}</div>
            <div class="note-meta">
                <span>${formatDate(note.updatedAt)}</span>
                <span class="note-tag">${tagText}</span>
            </div>
        `;

        li.addEventListener('click', () => selectNote(note.id));
        noteList.appendChild(li);
    });

    noteCountIndicator.textContent = `${notes.length} ${t('countSuffix')}`;
    noteListEmpty.style.display = notes.length ? 'none' : 'block';

    if (!keepTitle) {
        const currentCategory = db.categories.find(cat => cat.id === currentCategoryId);
        currentCategoryTitle.textContent = currentCategory ? getCategoryDisplayName(currentCategory.id) : t('allCategoryName');
    }
}

function getNotesForCurrentCategory() {
    if (currentCategoryId === DEFAULT_CATEGORY_ID) return getActiveNotes();
    if (currentCategoryId === TRASH_CATEGORY_ID) return db.notes.filter(note => note.isDeleted);
    if (currentCategoryId === PRIVATE_CATEGORY_ID) return getActiveNotes().filter(note => note.isPrivate);
    return getActiveNotes().filter(note => note.categoryId === currentCategoryId && !note.isPrivate);
}

// --- 交互 ---

function selectCategory(categoryId) {
    const leavingPrivate = currentCategoryId === PRIVATE_CATEGORY_ID && categoryId !== PRIVATE_CATEGORY_ID;
    currentCategoryId = categoryId;
    currentNoteId = null;
    if (leavingPrivate) relockPrivateNotes();
    hideNoteEditor();
    refreshSortOptions();
    renderCategoryList();
    renderNoteList();
}

async function selectNote(noteId) {
    const prevNoteId = currentNoteId;
    if (prevNoteId && prevNoteId !== noteId && unlockedSecrets[prevNoteId]) {
        relockPrivateNotes();
    }

    const note = db.notes.find(n => n.id === noteId);
    if (!note) return;
    currentNoteId = noteId;

    let displayTitle = note.title || '';
    let displayContent = note.content || '';
    let displayContentType = note.contentType || CONTENT_TYPES.PLAIN;

    if (note.isPrivate) {
        const unlocked = await unlockPrivate(note);
        if (!unlocked) return;
        displayTitle = unlocked.title || t('privateNote');
        displayContent = unlocked.content || '';
        displayContentType = unlocked.contentType || CONTENT_TYPES.PLAIN;
    }

    noteTitleInput.value = displayTitle;
    setEditorMode(displayContentType || CONTENT_TYPES.PLAIN, false);
    setEditorValue(displayContent, displayContentType || CONTENT_TYPES.PLAIN);
    lastModifiedInfo.textContent = `最后修改时间: ${formatDate(note.updatedAt)}`;
    lastModifiedInfo.textContent = `${t('lastModified')}: ${formatDate(note.updatedAt)}`;
    populateCategorySelect(note.categoryId);
    privateToggle.checked = note.isPrivate;

    const isDeleted = note.isDeleted;
    noteTitleInput.disabled = isDeleted;
    noteContentInput.disabled = isDeleted;
    if (quillEditor) quillEditor.enable(!isDeleted);
    saveNoteButton.disabled = isDeleted;
    privateToggle.disabled = isDeleted;
    noteCategorySelect.disabled = isDeleted || note.isPrivate;
    restoreNoteButton.style.display = isDeleted ? 'inline-flex' : 'none';

    showNoteEditor();
    renderNoteList();
}

function showNoteEditor() {
    noteEditor.style.display = 'flex';
    emptyNoteHint.style.display = 'none';
}

function hideNoteEditor() {
    noteEditor.style.display = 'none';
    emptyNoteHint.style.display = 'block';
    noteTitleInput.value = '';
    setEditorMode(CONTENT_TYPES.PLAIN, false);
    setEditorValue('', CONTENT_TYPES.PLAIN);
    lastModifiedInfo.textContent = `${t('lastModified')}: --`;
    currentNoteId = null;
    restoreNoteButton.style.display = 'none';
}

function createCategory() {
    const newCategoryName = prompt(t('promptNewCategory'));
    if (newCategoryName === null) return;
    const trimmedName = validateCategoryName(newCategoryName);
    if (!trimmedName) return;
    const newCategory = { id: 'cat_' + Date.now(), name: trimmedName, notes: [] };
    db.categories.push(newCategory);
    saveToLocalStorage();
    renderCategoryList();
    populateCategorySelect(noteCategorySelect.value);
}

function renameCategory(categoryId, currentName) {
    if ([DEFAULT_CATEGORY_ID, UNCATEGORIZED_CATEGORY_ID, PRIVATE_CATEGORY_ID, TRASH_CATEGORY_ID].includes(categoryId)) return alert(t('alertProtectedCategory'));
    const newName = prompt(t('promptRenameCategory'), currentName);
    if (!newName || newName.trim() === currentName) return;
    const trimmedName = validateCategoryName(newName, categoryId);
    if (!trimmedName) return;
    const category = db.categories.find(cat => cat.id === categoryId);
    if (!category) return;
    category.name = trimmedName;
    saveToLocalStorage();
    if (categoryId === currentCategoryId) currentCategoryTitle.textContent = trimmedName;
    renderCategoryList();
    populateCategorySelect(noteCategorySelect.value);
    renderNoteList();
}

function deleteCategory(categoryId) {
    if ([DEFAULT_CATEGORY_ID, UNCATEGORIZED_CATEGORY_ID, PRIVATE_CATEGORY_ID, TRASH_CATEGORY_ID].includes(categoryId)) return alert(t('alertProtectedCategoryDelete'));
    const category = db.categories.find(cat => cat.id === categoryId);
    if (!category) return;
    const confirmed = confirm(t('confirmDeleteCategory', category.name));
    if (!confirmed) return;

    db.notes.forEach(note => {
        if (note.categoryId === categoryId) note.categoryId = UNCATEGORIZED_CATEGORY_ID;
    });
    db.categories = db.categories.filter(cat => cat.id !== categoryId);
    rebuildCategoryRefs();
    saveToLocalStorage();
    if (categoryId === currentCategoryId) currentCategoryId = DEFAULT_CATEGORY_ID;
    renderCategoryList();
    renderNoteList();
    populateCategorySelect();
}

function createNote() {
    const targetCategory = (currentCategoryId === DEFAULT_CATEGORY_ID || currentCategoryId === TRASH_CATEGORY_ID)
        ? UNCATEGORIZED_CATEGORY_ID
        : currentCategoryId;
    const now = Date.now();
    const initialPrivate = currentCategoryId === PRIVATE_CATEGORY_ID;
    const titleBase = initialPrivate ? t('newPrivateNoteTitle') : t('newNoteTitle');
    const title = getUniqueTitle(titleBase, initialPrivate ? PRIVATE_CATEGORY_ID : targetCategory);
    const newNote = {
        id: 'note_' + now,
        title: initialPrivate ? t('privateNote') : title,
        content: '',
        contentType: CONTENT_TYPES.PLAIN,
        lastModified: formatDate(now),
        updatedAt: now,
        categoryId: initialPrivate ? PRIVATE_CATEGORY_ID : targetCategory,
        isPrivate: initialPrivate,
        isDeleted: false,
        encrypted: null,
        originalCategoryId: initialPrivate ? PRIVATE_CATEGORY_ID : targetCategory
    };
    db.notes.push(newNote);

    if (initialPrivate) {
        const pwd = prompt(t('promptSetPassword'));
        if (!pwd) {
            alert(t('alertCancelCreatePrivate'));
            db.notes = db.notes.filter(n => n.id !== newNote.id);
            return;
        }
        encryptPayload({ title, content: '', contentType: CONTENT_TYPES.PLAIN }, pwd)
            .then(enc => {
                newNote.encrypted = enc;
                unlockedSecrets[newNote.id] = { title, content: '', contentType: CONTENT_TYPES.PLAIN, password: pwd };
                finalizeNewNote(newNote);
            })
            .catch(() => {
                alert(t('alertEncryptFail'));
                db.notes = db.notes.filter(n => n.id !== newNote.id);
            });
    } else {
        finalizeNewNote(newNote);
    }
}

function finalizeNewNote(note) {
    rebuildCategoryRefs();
    saveToLocalStorage();
    renderCategoryList();
    renderNoteList();
    selectNote(note.id);
}

async function saveNote() {
    if (!currentNoteId) return;
    const note = db.notes.find(n => n.id === currentNoteId);
    if (!note) return;
    const newTitle = noteTitleInput.value.trim();
    if (!newTitle) return alert(t('alertEmptyTitle'));

    const mode = editorModeSelect?.value || currentEditorMode;
    const contentValue = getEditorContent(mode);

    const wantsPrivate = privateToggle.checked;
    let targetCategory = wantsPrivate ? PRIVATE_CATEGORY_ID : (noteCategorySelect.value || UNCATEGORIZED_CATEGORY_ID);

    if (!wantsPrivate && isNoteTitleDuplicate(newTitle, targetCategory, currentNoteId)) {
        return alert(t('alertDupNote'));
    }

    if (wantsPrivate) {
        const cache = unlockedSecrets[note.id];
        const pwd = cache?.password || prompt(t('promptSetPassword'));
        if (!pwd) return;
        const payload = { title: newTitle, content: contentValue, contentType: mode };
        try {
            const enc = await encryptPayload(payload, pwd);
            note.isPrivate = true;
            note.encrypted = enc;
            note.title = t('privateNote');
            note.content = '';
            note.contentType = mode;
            if (currentCategoryId === PRIVATE_CATEGORY_ID) {
                unlockedSecrets[note.id] = { ...payload, password: pwd };
            } else {
                delete unlockedSecrets[note.id];
            }
            targetCategory = PRIVATE_CATEGORY_ID;
        } catch (e) {
            alert(t('alertEncryptFailSave'));
            return;
        }
    } else {
        if (note.isPrivate && !unlockedSecrets[note.id]) {
            const unlocked = await unlockPrivate(note);
            if (!unlocked) return;
            noteTitleInput.value = unlocked.title;
            setEditorMode(unlocked.contentType || CONTENT_TYPES.PLAIN, false);
            setEditorValue(unlocked.content, unlocked.contentType || CONTENT_TYPES.PLAIN);
        }
        note.isPrivate = false;
        note.encrypted = null;
        note.title = newTitle;
        note.content = contentValue;
        note.contentType = mode;
    }

    note.updatedAt = Date.now();
    note.lastModified = formatDate(note.updatedAt);
    moveNoteToCategory(note.id, targetCategory);
    saveToLocalStorage();
    renderCategoryList();
    renderNoteList();
    lastModifiedInfo.textContent = `${t('lastModified')}: ${note.lastModified}`;
}

function deleteNote() {
    if (!currentNoteId) return;
    const note = db.notes.find(n => n.id === currentNoteId);
    if (!note) return;
    if (note.isDeleted) {
        const confirmed = confirm(t('confirmDeleteNotePermanent'));
        if (!confirmed) return;
        db.notes = db.notes.filter(n => n.id !== currentNoteId);
        delete unlockedSecrets[currentNoteId];
    } else {
        const confirmed = confirm(t('confirmDeleteNote', note.isPrivate ? t('privateNote') : note.title));
        if (!confirmed) return;
        note.isDeleted = true;
        moveNoteToCategory(note.id, TRASH_CATEGORY_ID);
    }
    rebuildCategoryRefs();
    saveToLocalStorage();
    hideNoteEditor();
    renderCategoryList();
    renderNoteList();
}

function restoreNote() {
    if (!currentNoteId) return;
    const note = db.notes.find(n => n.id === currentNoteId);
    if (!note || !note.isDeleted) return;
    const target = note.originalCategoryId || (note.isPrivate ? PRIVATE_CATEGORY_ID : UNCATEGORIZED_CATEGORY_ID);
    note.isDeleted = false;
    moveNoteToCategory(note.id, target);
    restoreNoteButton.style.display = 'none';
    renderCategoryList();
    renderNoteList();
    selectNote(note.id);
}

function moveNoteToCategory(noteId, targetCategoryId) {
    const note = db.notes.find(n => n.id === noteId);
    if (!note) return;
    const prevCategoryId = note.categoryId;
    if (targetCategoryId === TRASH_CATEGORY_ID && !note.originalCategoryId) {
        note.originalCategoryId = prevCategoryId === TRASH_CATEGORY_ID ? UNCATEGORIZED_CATEGORY_ID : prevCategoryId;
    }
    note.isDeleted = targetCategoryId === TRASH_CATEGORY_ID;
    note.categoryId = targetCategoryId;

    if (targetCategoryId !== PRIVATE_CATEGORY_ID && note.isPrivate && !note.isDeleted) {
        note.categoryId = PRIVATE_CATEGORY_ID;
        targetCategoryId = PRIVATE_CATEGORY_ID;
    }

    if (targetCategoryId !== TRASH_CATEGORY_ID) {
        note.originalCategoryId = note.categoryId;
    }

    rebuildCategoryRefs();
    saveToLocalStorage();
    if (
        currentCategoryId === DEFAULT_CATEGORY_ID ||
        currentCategoryId === prevCategoryId ||
        currentCategoryId === targetCategoryId
    ) {
        renderNoteList();
    }
}

function searchNotes() {
    const raw = searchInput.value.trim();
    const term = raw.toLowerCase();
    if (!term) {
        renderNoteList();
        return;
    }

    const scopeNotes = currentCategoryId === DEFAULT_CATEGORY_ID ? getActiveNotes() : getNotesForCurrentCategory();
    const filtered = scopeNotes.filter(note => {
        const unlocked = note.isPrivate ? unlockedSecrets[note.id] : null;
        const titleText = note.isPrivate ? (unlocked?.title || '') : (note.title || '');
        const contentType = note.isPrivate ? (unlocked?.contentType || CONTENT_TYPES.PLAIN) : (note.contentType || CONTENT_TYPES.PLAIN);
        const contentText = note.isPrivate ? (unlocked ? getContentText(unlocked.content || '', contentType) : '') : getContentText(note.content || '', contentType);
        const matchTitle = titleText.toLowerCase().includes(term);
        const matchContent = contentText.toLowerCase().includes(term);
        return matchTitle || matchContent;
    });

    currentCategoryTitle.textContent = t('searchTitle', raw);
    renderNoteList(filtered, true);
}

function clearSearch() {
    searchInput.value = '';
    renderNoteList();
    currentCategoryTitle.textContent = getCategoryName(currentCategoryId);
}

// --- 事件监听 ---

document.addEventListener('DOMContentLoaded', async () => {
    initLanguage();
    initTheme();
    initEditors();
    await initializeDB();
    applyLangToSystemCategories();
    refreshSortOptions();
    applyTranslations();
    renderCategoryList();
    renderNoteList();
    populateCategorySelect();
});

searchButton.addEventListener('click', searchNotes);
searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') searchNotes(); });
clearSearchButton.addEventListener('click', clearSearch);

addCategoryButtonFooter.addEventListener('click', createCategory);

renameCategoryButton.addEventListener('click', () => {
    const currentCategory = db.categories.find(cat => cat.id === currentCategoryId);
    if (!currentCategory) return;
    renameCategory(currentCategoryId, currentCategory.name);
});

deleteCategoryButton.addEventListener('click', () => {
    deleteCategory(currentCategoryId);
});

themeToggle?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(current === 'light' ? 'dark' : 'light');
});

langSelect?.addEventListener('change', (e) => {
    setLanguage(e.target.value);
});

newNoteButton.addEventListener('click', createNote);
sortSelect.addEventListener('change', () => renderNoteList());

noteCategorySelect.addEventListener('change', (e) => {
    if (currentNoteId) moveNoteToCategory(currentNoteId, e.target.value);
});

editorModeSelect?.addEventListener('change', (e) => {
    setEditorMode(e.target.value, true);
});

noteContentInput.addEventListener('input', () => {
    if (currentEditorMode === CONTENT_TYPES.MD) {
        renderMarkdownPreview(noteContentInput.value);
    }
});

saveNoteButton.addEventListener('click', saveNote);
deleteNoteButton.addEventListener('click', deleteNote);
restoreNoteButton.addEventListener('click', restoreNote);

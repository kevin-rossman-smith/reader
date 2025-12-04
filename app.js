(() => {
  const els = {
    fileInput: document.getElementById("file-input"),
    scroller: document.getElementById("page-scroller"),
    container: document.getElementById("page-container"),
    status: document.getElementById("status"),
    prev: document.getElementById("prev"),
    next: document.getElementById("next"),
    current: document.getElementById("current-page"),
    total: document.getElementById("total-pages"),
    bookmarkBtn: document.getElementById("bookmark-btn"),
    drawer: document.getElementById("drawer"),
    drawerToggle: document.getElementById("drawer-toggle"),
    drawerClose: document.getElementById("drawer-close"),
    bookList: document.getElementById("book-list"),
    bookSearch: document.getElementById("book-search"),
    bookmarkList: document.getElementById("bookmark-list"),
    loading: document.getElementById("loading-overlay"),
  };

  const storageKey = "bookmarks-v1";
  const userBooksKey = "user-books-v1";
  const prefsKey = "reader-prefs";
  let hideTimer = null;

  const state = {
    currentPage: 1,
    totalPages: 1,
    baseText: "",
    bookId: "local",
    pageTexts: [],
    pageTextsNormalized: [],
    userBooks: [],
    builtInBooks: [],
    parsedCache: {},
    dialogueMode: true,
    quoteNormalize: true,
    openAuthors: new Set(),
    currentTheme: "lamp",
    prefs: { theme: "lamp", pages: {} },
  };

  let bookmarkStore = loadBookmarkStore();
  const loadPrefs = () => {
    try {
      const saved = localStorage.getItem(prefsKey);
      state.prefs = saved ? JSON.parse(saved) : { theme: "lamp", pages: {} };
      state.currentTheme = state.prefs.theme || "lamp";
    } catch (e) {
      state.prefs = { theme: "lamp", pages: {} };
    }
  };

  const savePrefs = () => {
    try {
      localStorage.setItem(prefsKey, JSON.stringify(state.prefs));
    } catch (e) {
      console.warn("Could not save prefs", e);
    }
  };

  function loadBookmarkStore() {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      console.warn("Bookmark storage unavailable", e);
      return {};
    }
  }

  function saveBookmarkStore() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(bookmarkStore));
    } catch (e) {
      console.warn("Could not save bookmarks", e);
    }
  }

  let statusTimer = null;
  const normalizeText = (str) => str.toLowerCase().replace(/\s+/g, " ").trim();
  const makeSnippet = (text) => {
    const words = text.trim().split(/\s+/);
    const short = words.slice(0, 50).join(" ");
    return words.length > 50 ? short : text.trim();
  };
  const padParagraphs = (text) =>
    text
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter(Boolean)
      .join("\n\n");
  const normalizeQuotes = (text) => {
    let t = text;
    // Opening single quote used as dialogue starter -> double quote
    t = t.replace(/(^|[\s([{-])'(?=[A-Z0-9])/g, '$1"');
    // Closing single quote after word/ punctuation (not in contractions)
    t = t.replace(/([A-Za-z0-9.!?])'(?!\w)/g, '$1"');
    return t;
  };
  const splitLongBlock = (block) => {
    const sentences = block.split(/(?<=[.!?]["”']?)\s+/).map((s) => s.trim()).filter(Boolean);
    if (sentences.length < 2) return [block];
    const chunks = [];
    let current = "";
    sentences.forEach((s) => {
      if ((current + " " + s).trim().length > 500 && current) {
        chunks.push(current.trim());
        current = s;
      } else {
        current = current ? `${current} ${s}` : s;
      }
    });
    if (current) chunks.push(current.trim());
    return chunks;
  };
  const resolvePath = (basePath, relativePath) => {
    const base = new URL(basePath, "http://example.com/");
    const resolved = new URL(relativePath, base);
    return resolved.pathname.replace(/^\/+/, "");
  };
  const extractBlocksFromHtml = (htmlString) => {
    const doc = new DOMParser().parseFromString(htmlString, "text/html");
    const blocks = [];
    const push = (txt) => {
      const t = txt.replace(/\s+/g, " ").trim();
      if (t) {
        if (t.length > 800) {
          splitLongBlock(t).forEach((part) => blocks.push(part));
        } else {
          blocks.push(t);
        }
      }
    };
    const nodes = doc.querySelectorAll("p, div, section, article, blockquote, ul, ol, li, pre, br");
    nodes.forEach((node) => {
      const tag = node.tagName.toLowerCase();
      if (tag === "br") {
        blocks.push("");
        return;
      }
      if (tag === "blockquote") {
        push(`_${(node.textContent || "").trim()}_`);
        return;
      }
      if (tag === "ul" || tag === "ol") {
        Array.from(node.querySelectorAll("li")).forEach((li, idx) => {
          const bullet = tag === "ol" ? `${idx + 1}.` : "•";
          push(`_${bullet} ${(li.textContent || "").trim()}_`);
        });
        return;
      }
      if (tag === "pre") {
        const lines = (node.textContent || "")
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines.length) push(lines.join("\n"));
        return;
      }
      push(node.textContent || "");
    });
    return blocks;
  };

  const splitDialogue = (paragraph) => {
    const trimmed = paragraph.trim();
    if (!trimmed) return [];
    const quotePattern = /[“"]/g;
    const quoteCount = (trimmed.match(quotePattern) || []).length;
    if (quoteCount < 2 || trimmed.length < 120) {
      return [trimmed];
    }
    const parts = trimmed.split(/(?<=["”])\s+(?=[A-Z“"'])/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) return [trimmed];
    // If any split is too short, fallback to original.
    if (parts.some((p) => p.length < 20)) return [trimmed];
    return parts;
  };

  const setStatus = (msg) => {
    els.status.textContent = msg;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      if (els.status.textContent === msg) els.status.textContent = "";
    }, 2000);
  };

  let loadingCount = 0;
  const showLoading = (on) => {
    loadingCount = Math.max(0, loadingCount + (on ? 1 : -1));
    if (!els.loading) return;
    if (loadingCount > 0) {
      els.loading.classList.add("active");
    } else {
      els.loading.classList.remove("active");
    }
  };

  const applyTheme = (theme) => {
    const themes = ["lamp", "slate", "fern"];
    themes.forEach((t) => document.body.classList.remove(`theme-${t}`));
    document.body.classList.add(`theme-${theme}`);
    state.currentTheme = theme;
    state.prefs.theme = theme;
    savePrefs();
    document.querySelectorAll(".theme-btn").forEach((btn) => {
      const isActive = btn.dataset.theme === theme;
      btn.classList.toggle("active", isActive);
    });
  };

  const sanitizeParagraph = (text) => {
    const div = document.createElement("div");
    div.textContent = text.trim();
    return div.innerHTML;
  };

  const paginate = (text, target = 1) => {
    const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    els.scroller.innerHTML = "";
    state.totalPages = 1;
    state.currentPage = 1;
    state.pageTexts = [];
    state.pageTextsNormalized = [];
    if (!blocks.length) {
      els.scroller.innerHTML = "<div class=\"page\"><p>Nothing to display yet.</p></div>";
      els.current.textContent = 1;
      els.total.textContent = 1;
      state.pageTexts = [""];
      state.pageTextsNormalized = [""];
      return;
    }

    const containerWidth = els.container.clientWidth || window.innerWidth;
    const containerHeight = els.container.clientHeight || window.innerHeight * 0.7;

    const newPage = () => {
      const page = document.createElement("div");
      page.className = "page";
      page.style.width = `${containerWidth}px`;
      page.style.minHeight = `${containerHeight}px`;
      return page;
    };

    let currentPage = newPage();
    els.scroller.appendChild(currentPage);
    blocks.forEach((block) => {
      const p = document.createElement("p");
      p.innerHTML = sanitizeParagraph(block);
      currentPage.appendChild(p);

      const overflows = currentPage.scrollHeight > containerHeight && currentPage.childNodes.length > 1;
      if (overflows) {
        currentPage.removeChild(p);
        currentPage = newPage();
        currentPage.appendChild(p);
        els.scroller.appendChild(currentPage);
      }
    });

    state.pageTexts = Array.from(els.scroller.children).map((page) => page.textContent);
    state.pageTextsNormalized = state.pageTexts.map(normalizeText);

    const total = els.scroller.children.length;
    state.totalPages = total;
    els.total.textContent = total;
    goToPage(Math.min(target, total), false);
    setTimeout(() => showLoading(false), 0);
  };

  const goToPage = (page, persist = true) => {
    const width = els.container.clientWidth || 1;
    const clamped = Math.max(1, Math.min(page, state.totalPages));
    state.currentPage = clamped;
    els.current.textContent = clamped;
    els.container.scrollTo({ left: width * (clamped - 1), behavior: "smooth" });
    if (persist && state.bookId) {
      state.prefs.pages[state.bookId] = clamped;
      savePrefs();
    }
    showLoading(false);
  };

  const handleScroll = () => {
    const width = els.container.clientWidth || 1;
    const page = Math.round(els.container.scrollLeft / width) + 1;
    if (page !== state.currentPage) {
      state.currentPage = page;
      els.current.textContent = page;
    }
  };

  const addSwipeNavigation = (element) => {
    let startX = 0;
    element.addEventListener(
      "touchstart",
      (e) => {
        startX = e.touches[0].clientX;
      },
      { passive: true }
    );
    element.addEventListener(
      "touchend",
      (e) => {
        const deltaX = e.changedTouches[0].clientX - startX;
        if (Math.abs(deltaX) > 50) {
          deltaX > 0 ? goToPage(state.currentPage - 1) : goToPage(state.currentPage + 1);
        }
      },
      { passive: true }
    );
  };

  const prepareTextForPaging = (text) => {
    const paragraphs = text
      .split(/\n\s*\n/)
      .map((b) => {
        let block = b.trim();
        if (!block) return "";
        if (state.quoteNormalize) block = normalizeQuotes(block);
        return block;
      })
      .filter(Boolean);
    const processed = [];
    paragraphs.forEach((p) => {
      if (state.dialogueMode) {
        const splits = splitDialogue(p);
        processed.push(...splits);
      } else {
        processed.push(p);
      }
    });
    return padParagraphs(processed.join("\n\n"));
  };

  const loadTextIntoReader = (title, text, id = "local") => {
    showLoading(true);
    state.baseText = text;
    state.bookId = id;
    setStatus("Loaded. Paginating…");
    const storedPage = state.prefs.pages[id];
    requestAnimationFrame(() => paginate(prepareTextForPaging(state.baseText), storedPage || 1));
    refreshBookmarksDropdown();
  };

  const loadFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => setStatus("Could not read that file.");
    const ext = (file.name || "").toLowerCase();
    if (ext.endsWith(".epub")) {
      reader.onload = () => {
        const author = prompt("Enter author (First Last):", "")?.trim() || "Local";
        const folder = author.replace(/\s+/g, " ").trim() || "Local";
        const filePath = `${folder}/${file.name || "epub"}`;
        loadEpubFile(reader.result, file.name || "epub file", {
          persist: true,
          cacheId: filePath,
          filePath,
          titleOverride: file.name || "epub file",
        });
      };
      reader.readAsArrayBuffer(file);
    } else if (ext.endsWith(".txt") || ext.endsWith(".md") || ext.endsWith(".markdown") || !ext.includes(".")) {
      reader.onload = () => {
        const author = prompt("Enter author (First Last):", "")?.trim() || "Local";
        const text = reader.result.toString();
        const title = file.name || "local file";
        const folder = author.replace(/\s+/g, " ").trim() || "Local";
        const filePath = `${folder}/${title}`;
        const bookId = filePath;
        state.userBooks.unshift({ title, content: text, type: "text", file: filePath });
        saveUserBooks();
        renderBookList(state.builtInBooks, state.userBooks);
        loadTextIntoReader(title, text, bookId);
      };
      reader.readAsText(file);
    } else {
      setStatus("Unsupported file type. Try TXT, MD, or EPUB.");
    }
  };

  const loadRemoteBook = async (url, titleOverride) => {
    if (!url) return;
    try {
      setStatus("Fetching book…");
      showLoading(true);
      const lower = url.toLowerCase();
      if (lower.endsWith(".epub")) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = await res.arrayBuffer();
        await loadEpubFile(buffer, titleOverride || url.split("/").pop() || "Book", { persist: false, cacheId: url });
      } else {
        const res = await fetch(url, { cache: "no-cache" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        loadTextIntoReader(titleOverride || url.split("/").pop() || "Book", text, url);
      }
    } catch (err) {
      console.error(err);
      setStatus("Could not fetch that book.");
    } finally {
      showLoading(false);
    }
  };

  const loadEpubFile = async (arrayBuffer, filename, options = {}) => {
    if (!window.JSZip || typeof JSZip.loadAsync !== "function") {
      setStatus("EPUB support not available (JSZip missing).");
      return;
    }
    const { persist = false, cacheId = filename, filePath = null, titleOverride = null } = options;
    if (cacheId && state.parsedCache[cacheId]) {
      loadTextIntoReader(filename, state.parsedCache[cacheId], cacheId);
      return;
    }
    try {
      setStatus("Loading EPUB…");
      const zip = await JSZip.loadAsync(arrayBuffer);
      const containerFile = zip.file("META-INF/container.xml");
      if (!containerFile) throw new Error("container.xml not found");
      const containerXml = await containerFile.async("string");
      const containerDoc = new DOMParser().parseFromString(containerXml, "application/xml");
      const rootfile = containerDoc.querySelector("rootfile");
      const opfPath = rootfile ? rootfile.getAttribute("full-path") : null;
      if (!opfPath) throw new Error("OPF path missing");
      const opfFile = zip.file(opfPath);
      if (!opfFile) throw new Error("OPF file missing");
      const opfXml = await opfFile.async("string");
      const opfDoc = new DOMParser().parseFromString(opfXml, "application/xml");
      const title = titleOverride || opfDoc.querySelector("metadata > title")?.textContent?.trim() || filename;
      const manifest = {};
      opfDoc.querySelectorAll("manifest > item").forEach((item) => {
        manifest[item.getAttribute("id")] = {
          href: item.getAttribute("href"),
          type: item.getAttribute("media-type"),
        };
      });
      const spineIds = Array.from(opfDoc.querySelectorAll("spine > itemref")).map((i) =>
        i.getAttribute("idref")
      );
      const basePath = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

    const sections = [];
      for (const id of spineIds) {
        const item = manifest[id];
        if (!item || !item.href) continue;
        if (item.type && !/html|xhtml|xml/i.test(item.type)) continue;
        const href = resolvePath(basePath, item.href);
        const partFile = zip.file(href);
        if (!partFile) continue;
        const partHtml = await partFile.async("string");
        const blocks = extractBlocksFromHtml(partHtml);
        blocks.forEach((b) => {
          if (b) sections.push(b);
        });
      }

      const fullText = prepareTextForPaging(sections.join("\n\n"));
      if (!fullText) throw new Error("No readable text found in EPUB");

      if (cacheId) state.parsedCache[cacheId] = fullText;

      if (persist) {
        const bookId = filePath || cacheId || `epub-${Date.now()}`;
        state.userBooks.unshift({ title, content: fullText, type: "epub", file: filePath || title });
        saveUserBooks();
        renderBookList(state.builtInBooks, state.userBooks);
        loadTextIntoReader(title, fullText, bookId);
      } else {
        loadTextIntoReader(title, fullText, cacheId || `epub-${Date.now()}`);
      }
    } catch (err) {
      console.error(err);
      setStatus("Could not open EPUB. Try another file.");
    } finally {
      showLoading(false);
    }
  };

  const loadBookList = async () => {
    if (!els.bookList) return;
    try {
      const res = await fetch("books/index.json", { cache: "no-cache" });
      if (!res.ok) throw new Error("Could not load books/index.json");
      state.builtInBooks = await res.json();
      renderBookList(state.builtInBooks, state.userBooks);
    } catch (err) {
      console.warn("Could not load book list", err);
      els.bookList.innerHTML = '<span class="empty-note">No books found.</span>';
    }
  };

  const loadUserBooks = () => {
    try {
      const saved = localStorage.getItem(userBooksKey);
      state.userBooks = saved ? JSON.parse(saved) : [];
    } catch (err) {
      state.userBooks = [];
    }
  };

  const saveUserBooks = () => {
    try {
      localStorage.setItem(userBooksKey, JSON.stringify(state.userBooks));
    } catch (err) {
      console.warn("Could not save user books", err);
    }
  };

  const renderBookList = (builtIns = [], userBooks = [], term = "") => {
    if (!els.bookList) return;
    els.bookList.innerHTML = "";
    const needle = normalizeText(term);
    const toAuthor = (filePath, isLocal) => {
      if (isLocal && filePath) {
        const folder = filePath.split("/")[0] || "Local";
        return folder.replace(/_/g, " ").replace(/\s+/g, " ").trim() || "Local";
      }
      if (isLocal || !filePath) return "Local";
      const folder = filePath.split("/")[0] || "";
      let name = folder.replace(/_/g, " ").trim();
      if (name.includes(",")) {
        const parts = name.split(",");
        if (parts.length >= 2) {
          name = `${parts[1].trim()} ${parts[0].trim()}`.trim();
        }
      }
      name = name.replace(/\s+/g, " ");
      return name;
    };

    const combined = [
      ...builtIns.map((b) => ({
        title: b.title,
        id: `builtin-${b.file}`,
        fetchUrl: `books/${b.file}`,
        type: "text",
        author: toAuthor(b.file, false),
      })),
      ...userBooks.map((b, i) => ({
        title: b.title,
        id: `user-${i}`,
        content: b.content,
        type: b.type || "text",
        author: toAuthor(b.file, true),
      })),
    ];

    const grouped = {};
    combined.forEach((item) => {
      const match =
        !needle ||
        normalizeText(item.title).includes(needle) ||
        normalizeText(item.author).includes(needle);
      if (!match) return;
      grouped[item.author] = grouped[item.author] || [];
      grouped[item.author].push(item);
    });

    const authors = Object.keys(grouped).sort((a, b) => a.localeCompare(b));
    if (!authors.length) {
      els.bookList.innerHTML = '<span class="empty-note">No matches.</span>';
      return;
    }

    authors.forEach((author) => {
      const header = document.createElement("div");
      header.className = "author-row";
      if (!state.openAuthors.has(author)) header.classList.add("closed");
      const caret = document.createElement("div");
      caret.className = "caret";
      const name = document.createElement("div");
      name.className = "book-title";
      name.textContent = author;
      header.append(caret, name);
      const children = document.createElement("div");
      children.className = "book-children";
      if (!state.openAuthors.has(author)) {
        children.style.display = "none";
      }

      grouped[author]
        .sort((a, b) => a.title.localeCompare(b.title))
        .forEach((item) => {
          const row = document.createElement("div");
          row.className = "book-row";
          const title = document.createElement("div");
          title.className = "book-title";
          title.textContent = item.title;
          const meta = document.createElement("div");
          meta.className = "book-meta";
          meta.textContent = item.content ? "Local" : "Built-in";
          row.append(title, meta);
          row.addEventListener("click", () => {
            if (item.content) {
              loadTextIntoReader(item.title, item.content, item.id);
            } else if (item.fetchUrl) {
              loadRemoteBook(item.fetchUrl, item.title);
            }
            closeDrawer();
          });
          children.appendChild(row);
        });

      header.addEventListener("click", () => {
        const isOpen = state.openAuthors.has(author);
        if (isOpen) {
          state.openAuthors.delete(author);
          children.style.display = "none";
          header.classList.add("closed");
        } else {
          state.openAuthors.add(author);
          children.style.display = "flex";
          header.classList.remove("closed");
        }
      });

      els.bookList.append(header, children);
    });
  };

  const getBookmarksForCurrent = () => bookmarkStore[state.bookId] || [];

  const refreshBookmarksDropdown = () => {
    if (!els.bookmarkList) return;
    const list = getBookmarksForCurrent().sort((a, b) => b.ts - a.ts);
    if (!list.length) {
      els.bookmarkList.classList.add("empty-note");
      els.bookmarkList.textContent = "No bookmarks yet.";
      return;
    }
    els.bookmarkList.classList.remove("empty-note");
    els.bookmarkList.innerHTML = "";
    list.forEach((bm) => {
      const btn = document.createElement("button");
      const stamp = new Date(bm.ts).toLocaleString();
      btn.textContent = `${stamp} — ${bm.snippet.slice(0, 60)}`;
      btn.addEventListener("click", () => {
        navigateToBookmark(bm.id);
        closeDrawer();
      });
      els.bookmarkList.appendChild(btn);
    });
  };

  const addBookmark = () => {
    const selection = window.getSelection().toString().trim();
    const currentPage = state.currentPage;
    if (!currentPage) {
      setStatus("Failed to bookmark. Try again when a page is loaded.");
      return;
    }
    if (!selection) {
      setStatus("Select some text before bookmarking.");
      return;
    }

    const attempt = (snippetText) => {
      const snippet = makeSnippet(snippetText);
      const normalized = normalizeText(snippet);
      const page = findPageForSnippet(normalized);
      return { snippet, normalized, page };
    };

    let { snippet, normalized, page } = attempt(selection);
    if (page !== currentPage) {
      const pageEl = els.scroller.children[currentPage - 1];
      const firstP = pageEl ? pageEl.querySelector("p") : null;
      const fallbackText = firstP ? firstP.textContent || "" : "";
      if (fallbackText.trim()) {
        const res = attempt(fallbackText);
        if (res.page === currentPage) {
          snippet = res.snippet;
          normalized = res.normalized;
          page = res.page;
        } else {
          setStatus("Failed to bookmark. Try bookmarking simpler text.");
          return;
        }
      } else {
        setStatus("Failed to bookmark. Try bookmarking simpler text.");
        return;
      }
    }

    const entry = {
      id: `${Date.now()}`,
      snippet,
      normalizedSnippet: normalized,
      page,
      ts: Date.now(),
    };
    const list = bookmarkStore[state.bookId] || [];
    list.push(entry);
    bookmarkStore[state.bookId] = list;
    saveBookmarkStore();
    refreshBookmarksDropdown();
    setStatus("Bookmark saved.");
  };

  const clearHighlights = () => {
    els.scroller.querySelectorAll(".bookmark-hit").forEach((el) => el.classList.remove("bookmark-hit"));
  };

  const navigateToBookmark = (id) => {
    if (!id) return;
    const list = getBookmarksForCurrent();
    const target = list.find((b) => b.id === id);
    if (!target) return;
    const snippet = target.snippet;
    const snippetNormalized = normalizeText(snippet);
    console.log("Searching for bookmark snippet:", snippetNormalized);
    clearHighlights();

    const tryPage = (idx) => {
      const page = els.scroller.children[idx];
      if (!page) return false;
      const paragraph = Array.from(page.querySelectorAll("p")).find((p) =>
        normalizeText(p.textContent).includes(snippetNormalized)
      );
      if (paragraph) {
        paragraph.classList.add("bookmark-hit");
        goToPage(idx + 1);
        setStatus("Jumped to bookmark.");
        return true;
      }
      return false;
    };

    let found = false;
    if (typeof target.page === "number" && target.page > 0) {
      found = tryPage(target.page - 1);
    }
    if (!found) {
      state.pageTextsNormalized.some((text, idx) => {
        if (text.includes(snippetNormalized)) {
          found = tryPage(idx);
          return true;
        }
        return false;
      });
    }
    if (!found) {
      console.log("Bookmark snippet not found in current pagination.");
      setStatus("Bookmark text not found in current pagination.");
    }
  };

  const findPageForSnippet = (snippetNormalized) => {
    if (!snippetNormalized) return null;
    const idx = state.pageTextsNormalized.findIndex((t) => t.includes(snippetNormalized));
    return idx >= 0 ? idx + 1 : null;
  };

  const init = () => {
    loadPrefs();
    loadUserBooks();
    els.fileInput.addEventListener("change", (e) => loadFile(e.target.files?.[0]));
    const themeButtons = document.querySelectorAll(".theme-btn");
    themeButtons.forEach((btn) =>
      btn.addEventListener("click", () => {
        const theme = btn.dataset.theme;
        applyTheme(theme);
        if (state.baseText) {
          requestAnimationFrame(() => paginate(prepareTextForPaging(state.baseText), state.currentPage));
        }
      })
    );
    applyTheme(state.currentTheme || "lamp");
    document.addEventListener("pointerdown", (e) => {
      const withinDrawer = e.target.closest(".drawer");
      const toggle = e.target.closest("#drawer-toggle");
      if (withinDrawer || toggle) return;
      if (els.drawer && els.drawer.classList.contains("open")) {
        closeDrawer();
      }
    });
    if (els.bookSearch) {
      const debounce = (fn, wait = 200) => {
        let t;
        return (...args) => {
          clearTimeout(t);
          t = setTimeout(() => fn(...args), wait);
        };
      };
      els.bookSearch.addEventListener(
        "input",
        debounce((e) => {
          const term = e.target.value || "";
          renderBookList(state.builtInBooks, state.userBooks, term);
        }, 200)
      );
    }
    els.prev.addEventListener("click", () => goToPage(state.currentPage - 1));
    els.next.addEventListener("click", () => goToPage(state.currentPage + 1));
    els.container.addEventListener("scroll", handleScroll);
    addSwipeNavigation(els.container);

    els.bookmarkBtn.addEventListener("click", addBookmark);
    const resizeObserver = new ResizeObserver(() => {
      if (state.baseText) {
        requestAnimationFrame(() => paginate(prepareTextForPaging(state.baseText), state.currentPage));
      }
    });
    resizeObserver.observe(els.container);

    loadBookList();
    renderBookList(state.builtInBooks, state.userBooks);
    refreshBookmarksDropdown();
  };

  const hideChrome = () => {
    document.body.classList.add("chrome-hidden");
  };

  const showChrome = () => {
    document.body.classList.remove("chrome-hidden");
  };

  const resetInactivityTimer = () => {
    showChrome();
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      if (hideTimer) clearTimeout(hideTimer);
      return;
    }
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(hideChrome, 2000);
  };

  const toggleChromeOnTap = (e) => {
    // ignore taps on controls
    const ignore = e.target.closest("header, .nav, button, select, input, label, .drawer");
    if (ignore) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      // avoid toggling/hiding when text is selected (e.g., long press for bookmark)
      showChrome();
      return;
    }
    const hidden = document.body.classList.contains("chrome-hidden");
    if (hidden) {
      showChrome();
      resetInactivityTimer();
    } else {
      hideChrome();
      if (hideTimer) clearTimeout(hideTimer);
    }
  };

  const bindChromeControls = () => {
    // only pointerup toggles; no mousemove/keypress to show
    document.addEventListener("pointerup", toggleChromeOnTap);
    resetInactivityTimer();
  };

  const openDrawer = () => {
    els.drawer.classList.add("open");
    els.drawer.removeAttribute("aria-hidden");
    els.drawer.removeAttribute("hidden");
  };

  const closeDrawer = () => {
    els.drawer.classList.remove("open");
    els.drawer.setAttribute("aria-hidden", "true");
    els.drawer.setAttribute("hidden", "");
    if (document.activeElement && els.drawer.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  };

  const toggleDrawer = () => {
    const isOpen = els.drawer.classList.contains("open");
    if (isOpen) closeDrawer();
    else openDrawer();
  };

  init();
  bindChromeControls();
  if (els.drawerToggle) els.drawerToggle.addEventListener("click", toggleDrawer);
  if (els.drawerClose) els.drawerClose.addEventListener("click", closeDrawer);

  // Prevent vertical scroll from wheel/trackpad while allowing horizontal paging
  document.addEventListener(
    "wheel",
    (e) => {
      const insideDrawer = e.target.closest(".drawer, .scroll-area");
      if (insideDrawer) return;
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
      }
    },
    { passive: false }
  );
})();

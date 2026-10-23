(function universalModuleDefinition(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.LingXingPageClient = api;
  }
}(typeof globalThis === 'object' ? globalThis : this, function createModule() {
  'use strict';

  const VERSION = '1.0.0';
  const TRANSPORTS = Object.freeze(['post', 'gwPost', 'gateGet', 'gatePost']);
  const DEFAULT_SELECTORS = Object.freeze([
    '#app',
    '.app-wrapper',
    '.el-main',
    '.fba-shipment',
  ]);

  class LingXingPageClientError extends Error {
    constructor(code, message, details, cause) {
      super(message);
      this.name = 'LingXingPageClientError';
      this.code = code;
      this.details = details || {};
      if (cause !== undefined) this.cause = cause;
    }

    toJSON() {
      return {
        name: this.name,
        code: this.code,
        message: this.message,
        details: this.details,
      };
    }
  }

  function error(code, message, details, cause) {
    return new LingXingPageClientError(code, message, details, cause);
  }

  function safeRead(target, key, diagnostics) {
    if (target == null) return undefined;
    try {
      return target[key];
    } catch (_) {
      if (diagnostics) diagnostics.readErrors += 1;
      return undefined;
    }
  }

  function safePush(queue, value) {
    if (value == null) return;
    if ((typeof value === 'object' || typeof value === 'function')) queue.push(value);
  }

  function normalizeBusinessResponse(response) {
    if (response && typeof response === 'object') {
      if (response.code !== undefined) return response;
      if (response.data && typeof response.data === 'object' && response.data.code !== undefined) {
        return response.data;
      }
    }
    return response;
  }

  function getPageWindow(explicitWindow) {
    if (explicitWindow && typeof explicitWindow === 'object') return explicitWindow;
    if (typeof unsafeWindow === 'object' && unsafeWindow) return unsafeWindow;
    if (typeof window === 'object' && window) return window;
    return null;
  }

  function getPageDocument(pageWindow, explicitDocument) {
    if (explicitDocument && typeof explicitDocument.querySelector === 'function') {
      return explicitDocument;
    }
    try {
      if (pageWindow && pageWindow.document) return pageWindow.document;
    } catch (_) {
      // A structured context error is returned by discoverTransports.
    }
    return null;
  }

  function normalizeRequiredTransports(input) {
    if (input == null) return [];
    if (!Array.isArray(input)) {
      throw error(
        'LINGXING_INVALID_ARGUMENT',
        'requiredTransports 必须是数组。',
        { argument: 'requiredTransports' },
      );
    }
    const unique = [];
    for (const value of input) {
      if (!TRANSPORTS.includes(value)) {
        throw error(
          'LINGXING_INVALID_ARGUMENT',
          `不支持的领星请求传输层：${String(value)}`,
          { argument: 'requiredTransports', supported: [...TRANSPORTS] },
        );
      }
      if (!unique.includes(value)) unique.push(value);
    }
    return unique;
  }

  function collectVueRoots(pageDocument, selectors, extraRoots, diagnostics) {
    const roots = [];
    const seen = new Set();

    function add(value) {
      if (value == null || seen.has(value)) return;
      if (typeof value !== 'object' && typeof value !== 'function') return;
      seen.add(value);
      roots.push(value);
    }

    if (Array.isArray(extraRoots)) extraRoots.forEach(add);
    if (!pageDocument) return roots;

    for (const selector of selectors) {
      let elements = [];
      try {
        if (typeof pageDocument.querySelectorAll === 'function') {
          elements = Array.from(pageDocument.querySelectorAll(selector));
        } else if (typeof pageDocument.querySelector === 'function') {
          const element = pageDocument.querySelector(selector);
          if (element) elements = [element];
        }
      } catch (_) {
        diagnostics.selectorErrors += 1;
      }

      for (const element of elements) {
        add(safeRead(element, '__vue__', diagnostics));
        const component = safeRead(element, '__vueParentComponent', diagnostics);
        add(safeRead(component, 'proxy', diagnostics));
        add(safeRead(component, 'ctx', diagnostics));
      }
    }

    return roots;
  }

  function inspectCandidate(candidate, bindings, diagnostics) {
    if (!bindings.post) {
      const method = safeRead(candidate, '$post', diagnostics);
      if (typeof method === 'function') bindings.post = { owner: candidate, method };
    }

    if (!bindings.gwPost) {
      const method = safeRead(candidate, '$gwPost', diagnostics);
      if (typeof method === 'function') bindings.gwPost = { owner: candidate, method };
    }

    const gateAxios = safeRead(candidate, '$gateAxios', diagnostics);
    if (gateAxios && (typeof gateAxios === 'object' || typeof gateAxios === 'function')) {
      if (!bindings.gateGet) {
        const method = safeRead(gateAxios, 'get', diagnostics);
        if (typeof method === 'function') bindings.gateGet = { owner: gateAxios, method };
      }
      if (!bindings.gatePost) {
        const method = safeRead(gateAxios, 'post', diagnostics);
        if (typeof method === 'function') bindings.gatePost = { owner: gateAxios, method };
      }
    }
  }

  function pageIdentity(pageWindow) {
    try {
      const location = pageWindow && pageWindow.location;
      return {
        origin: location && typeof location.origin === 'string' ? location.origin : '',
        pathname: location && typeof location.pathname === 'string' ? location.pathname : '',
      };
    } catch (_) {
      return { origin: '', pathname: '' };
    }
  }

  function discoverTransports(options) {
    const opts = options || {};
    const pageWindow = getPageWindow(opts.pageWindow);
    const pageDocument = getPageDocument(pageWindow, opts.pageDocument);
    const selectors = Array.isArray(opts.selectors) && opts.selectors.length > 0
      ? opts.selectors.map(String)
      : [...DEFAULT_SELECTORS];
    const maxNodes = Number.isInteger(opts.maxNodes) && opts.maxNodes > 0
      ? opts.maxNodes
      : 5000;
    const scan = {
      scannedAt: new Date().toISOString(),
      rootCount: 0,
      visitedCount: 0,
      truncated: false,
      readErrors: 0,
      selectorErrors: 0,
    };

    if (!pageDocument && !(Array.isArray(opts.roots) && opts.roots.length > 0)) {
      throw error(
        'LINGXING_PAGE_CONTEXT_UNAVAILABLE',
        '无法访问领星页面上下文。请在领星 ERP 页面内运行，并传入 unsafeWindow。',
        { hasPageWindow: Boolean(pageWindow), rawFetchFallback: false },
      );
    }

    const roots = collectVueRoots(pageDocument, selectors, opts.roots, scan);
    scan.rootCount = roots.length;
    const queue = roots.slice();
    const seen = new Set();
    const bindings = Object.create(null);

    while (queue.length > 0 && seen.size < maxNodes) {
      const candidate = queue.shift();
      if (candidate == null || seen.has(candidate)) continue;
      if (typeof candidate !== 'object' && typeof candidate !== 'function') continue;
      seen.add(candidate);
      inspectCandidate(candidate, bindings, scan);

      const children = safeRead(candidate, '$children', scan);
      if (Array.isArray(children)) children.forEach((child) => safePush(queue, child));
      safePush(queue, safeRead(candidate, '$parent', scan));
      safePush(queue, safeRead(candidate, '$root', scan));

      // Vue 3 component internals. These are discovery hints only; credentials and
      // browser storage are intentionally never inspected.
      const component = safeRead(candidate, '$', scan);
      safePush(queue, safeRead(component, 'parent', scan));
      safePush(queue, safeRead(component, 'root', scan));
      safePush(queue, safeRead(component, 'proxy', scan));
      safePush(queue, safeRead(component, 'ctx', scan));
    }

    scan.visitedCount = seen.size;
    scan.truncated = queue.length > 0;
    const availableTransports = TRANSPORTS.filter((name) => Boolean(bindings[name]));
    return {
      pageWindow,
      pageDocument,
      selectors,
      maxNodes,
      bindings,
      diagnostics: {
        sdkVersion: VERSION,
        page: pageIdentity(pageWindow),
        availableTransports,
        scan,
        security: {
          usesPageRequestClientsOnly: true,
          rawFetchFallback: false,
          readsCredentials: false,
        },
      },
    };
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function validatePath(path) {
    if (
      typeof path !== 'string'
      || path.trim() !== path
      || path.length < 2
      || !path.startsWith('/')
      || path.startsWith('//')
      || /[\\\u0000-\u001f\u007f]/.test(path)
      || /^[a-z][a-z0-9+.-]*:/i.test(path)
    ) {
      throw error(
        'LINGXING_INVALID_ARGUMENT',
        '请求 path 必须是以单个 / 开头的领星站内相对路径，不能是绝对 URL、协议相对地址或包含反斜杠/控制字符。',
        { argument: 'path', requiresRelativePath: true },
      );
    }
  }

  class PageClient {
    constructor(options, discovery, requiredTransports, waitDiagnostics) {
      this._options = Object.assign({}, options || {});
      this._requiredTransports = requiredTransports.slice();
      this._discovery = discovery;
      this._waitDiagnostics = waitDiagnostics || null;
    }

    capabilities() {
      return {
        transports: this._discovery.diagnostics.availableTransports.slice(),
        rawFetchFallback: false,
      };
    }

    diagnostics() {
      const available = this._discovery.diagnostics.availableTransports.slice();
      return {
        sdkVersion: VERSION,
        page: Object.assign({}, this._discovery.diagnostics.page),
        selectors: this._discovery.selectors.slice(),
        requiredTransports: this._requiredTransports.slice(),
        availableTransports: available,
        missingTransports: this._requiredTransports.filter((name) => !available.includes(name)),
        scan: Object.assign({}, this._discovery.diagnostics.scan),
        wait: this._waitDiagnostics ? Object.assign({}, this._waitDiagnostics) : null,
        security: Object.assign({}, this._discovery.diagnostics.security),
      };
    }

    refresh() {
      this._discovery = discoverTransports(this._options);
      return this.diagnostics();
    }

    _binding(name) {
      let binding = this._discovery.bindings[name];
      if (!binding) {
        this.refresh();
        binding = this._discovery.bindings[name];
      }
      if (!binding) {
        const diagnostics = this.diagnostics();
        throw error(
          'LINGXING_TRANSPORT_UNAVAILABLE',
          `当前领星页面未找到请求传输层 ${name}。请确认页面已加载且探针证据中的调用层与页面一致。`,
          { transport: name, diagnostics },
        );
      }
      return binding;
    }

    async _invoke(name, path, args) {
      validatePath(path);
      const binding = this._binding(name);
      try {
        return await binding.method.call(binding.owner, path, ...args);
      } catch (cause) {
        if (cause instanceof LingXingPageClientError) throw cause;
        throw error(
          'LINGXING_REQUEST_FAILED',
          `领星 ${name} 请求失败：${cause && cause.message ? cause.message : String(cause)}`,
          { transport: name, path },
          cause,
        );
      }
    }

    async post(path, payload, options) {
      const opts = options || {};
      const requestConfig = opts.requestConfig || {};
      const arg4 = opts.arg4 === undefined ? null : opts.arg4;
      const arg5 = opts.arg5 === undefined ? null : opts.arg5;
      const sequenceGroup = opts.sequenceGroup === undefined ? null : opts.sequenceGroup;
      const response = await this._invoke(
        'post',
        path,
        [payload, requestConfig, arg4, arg5, sequenceGroup],
      );
      return opts.normalizeBusiness === false ? response : normalizeBusinessResponse(response);
    }

    async gwPost(path, payload, options) {
      const opts = options || {};
      const response = await this._invoke('gwPost', path, [payload]);
      return opts.normalizeBusiness === false ? response : normalizeBusinessResponse(response);
    }

    async gateGet(path, config) {
      return this._invoke('gateGet', path, [config || {}]);
    }

    async gatePost(path, payload, config) {
      return this._invoke('gatePost', path, [payload, config || {}]);
    }
  }

  function find(options) {
    const requiredTransports = normalizeRequiredTransports(
      options && options.requiredTransports,
    );
    const discovery = discoverTransports(options);
    return new PageClient(options, discovery, requiredTransports, {
      elapsedMs: 0,
      attempts: 1,
      timedOut: false,
    });
  }

  async function connect(options) {
    const opts = options || {};
    const requiredTransports = normalizeRequiredTransports(opts.requiredTransports);
    const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs >= 0
      ? Number(opts.timeoutMs)
      : 15000;
    const pollMs = Number.isFinite(opts.pollMs) && opts.pollMs > 0
      ? Number(opts.pollMs)
      : 250;
    const startedAt = Date.now();
    let attempts = 0;
    let lastDiscovery = null;

    do {
      attempts += 1;
      lastDiscovery = discoverTransports(opts);
      const available = lastDiscovery.diagnostics.availableTransports;
      const missing = requiredTransports.filter((name) => !available.includes(name));
      if (missing.length === 0) {
        return new PageClient(opts, lastDiscovery, requiredTransports, {
          elapsedMs: Date.now() - startedAt,
          attempts,
          timedOut: false,
        });
      }
      if (Date.now() - startedAt >= timeoutMs) break;
      await delay(Math.min(pollMs, Math.max(1, timeoutMs - (Date.now() - startedAt))));
    } while (Date.now() - startedAt <= timeoutMs);

    const available = lastDiscovery
      ? lastDiscovery.diagnostics.availableTransports
      : [];
    const missing = requiredTransports.filter((name) => !available.includes(name));
    throw error(
      'LINGXING_CLIENT_TIMEOUT',
      `等待领星页面请求客户端超时；缺少：${missing.join('、') || '未知传输层'}。`,
      {
        timeoutMs,
        attempts,
        requiredTransports,
        availableTransports: available,
        missingTransports: missing,
        diagnostics: lastDiscovery ? lastDiscovery.diagnostics : null,
      },
    );
  }

  return Object.freeze({
    VERSION,
    TRANSPORTS,
    DEFAULT_SELECTORS,
    LingXingPageClientError,
    normalizeBusinessResponse,
    discoverTransports,
    find,
    connect,
  });
}));

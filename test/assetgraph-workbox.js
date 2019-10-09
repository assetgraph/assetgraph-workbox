const pathModule = require('path');
const expect = require('unexpected')
  .clone()
  .use(require('unexpected-assetgraph'))
  .use(require('unexpected-sinon'));
const AssetGraph = require('assetgraph');
const sinon = require('sinon');
const assetgraphWorkbox = require('../lib/assetgraph-workbox');

describe('assetgraph-workbox', function() {
  it('should add a precache service worker to a single HTML page', async function() {
    const warnSpy = sinon.spy().named('warn');
    const assetGraph = new AssetGraph({
      root: pathModule.resolve(__dirname, '../testdata/singlePage/')
    });
    await assetGraph
      .on('warn', warnSpy)
      .loadAssets('index.html')
      .populate({
        followRelations: { to: { protocol: 'file:' } }
      });

    expect(warnSpy, 'to have calls satisfying', () =>
      warnSpy(/^ENOENT.*notFound\.js/)
    );

    expect(assetGraph, 'to contain assets', 9);
    expect(assetGraph, 'to contain relations', 9);
    expect(assetGraph, 'to contain asset', 'Png');
    expect(assetGraph, 'to contain assets', 'Html', 2);
    expect(assetGraph, 'to contain asset', { type: 'Html', isInline: true });
    expect(assetGraph, 'to contain asset', 'Css');
    expect(
      assetGraph,
      'to contain assets',
      { type: 'JavaScript', isLoaded: true },
      2
    );
    expect(assetGraph, 'to contain asset', {
      type: 'JavaScript',
      isLoaded: false,
      fileName: 'notFound.js'
    });

    await assetgraphWorkbox(assetGraph, { query: { isInitial: true } });

    expect(assetGraph, 'to contain relations', 'HtmlScript', 4);
    expect(assetGraph, 'to contain relations', 'JavaScriptStaticUrl', 4);
    expect(
      assetGraph,
      'to contain relation',
      'JavaScriptServiceWorkerRegistration',
      1
    );
    expect(assetGraph, 'to contain asset', {
      url: `${assetGraph.root}index-precache-service-worker.js`
    });
    expect(
      assetGraph.findAssets({ type: 'Html' })[0].text,
      'to contain',
      "<script>if ('serviceWorker' in navigator)"
    );
    const serviceWorker = assetGraph.findAssets({
      fileName: 'index-precache-service-worker.js'
    })[0];
    expect(serviceWorker.text, 'to contain', 'foo.png')
      .and('to contain', '"/modernBrowsers.js".toString(\'url\')')
      .and('to contain', 'style.css')
      .and('not to contain', 'fixIE6.js');
  });

  describe('with minify:true', function() {
    it('should minify the service worker and the registration script', async function() {
      const warnSpy = sinon.spy().named('warn');
      const assetGraph = new AssetGraph({
        root: pathModule.resolve(__dirname, '../testdata/singlePage/')
      });
      assetGraph.on('warn', warnSpy);
      await assetGraph.loadAssets('index.html');
      await assetGraph.populate({
        followRelations: { to: { protocol: 'file:' } }
      });
      await assetgraphWorkbox(assetGraph, {
        query: { isInitial: true },
        minify: true
      });

      expect(
        assetGraph,
        'to contain assets',
        {
          type: 'JavaScript',
          _toBeMinified: true
        },
        2
      );
    });
  });

  it('should relay warning messages from sw-precache', async function() {
    const warnSpy = sinon.spy().named('warn');
    const root = pathModule.resolve(
      __dirname,
      '../testdata/deprecatedConfigOption/'
    );
    const assetGraph = new AssetGraph({ root });

    assetGraph.on('warn', warnSpy);
    await assetGraph.loadAssets('index.html');
    await assetGraph.populate({
      followRelations: { to: { protocol: 'file:' } }
    });

    await assetgraphWorkbox(assetGraph, {
      query: {
        isInitial: true
      },
      configPath: pathModule.resolve(root, 'sw-precache-config.js')
    });

    expect(warnSpy, 'to have calls satisfying', () => {
      warnSpy(
        "index-precache-service-worker.js: Specifying 'cacheFirst'' in a 'runtimeCaching[].handler' option is deprecated. Please update your config to use 'CacheFirst' instead. In v4 Workbox strategies are now classes instead of functions."
      );
    });
  });

  it('should add precache service workers to multiple pages', async function() {
    const assetGraph = new AssetGraph({
      root: pathModule.resolve(__dirname, '../testdata/multiPage/')
    });
    await assetGraph.loadAssets('*.html').populate();

    expect(assetGraph, 'to contain assets', 3);
    expect(assetGraph, 'to contain relations', 4);
    expect(assetGraph, 'to contain asset', 'Png');
    expect(assetGraph, 'to contain assets', 'Html', 2);
    expect(assetGraph, 'to contain relations', 'HtmlIFrame');
    expect(assetGraph, 'to contain relations', 'HtmlImage', 2);

    await assetgraphWorkbox(assetGraph, { query: { isInitial: true } });

    expect(
      assetGraph,
      'to contain relation',
      'JavaScriptServiceWorkerRegistration',
      2
    );
    expect(assetGraph, 'to contain relations', 'JavaScriptStaticUrl', 5);
    expect(assetGraph, 'to contain relations', 'HtmlScript', 2);
    expect(assetGraph, 'to contain asset', {
      url: `${assetGraph.root}index-precache-service-worker.js`
    }).and('to contain asset', {
      url: `${assetGraph.root}otherpage-precache-service-worker.js`
    });
  });

  it('should give up when the target location of the service worker is clobbered', async function() {
    const warnSpy = sinon.spy().named('warn');
    const assetGraph = new AssetGraph({
      root: pathModule.resolve(__dirname, '../testdata/singlePage/')
    });
    await assetGraph
      .on('warn', warnSpy)
      .loadAssets('index.html')
      .populate({ followRelations: { to: { protocol: 'file:' } } });

    assetGraph.addAsset(
      new AssetGraph().addAsset({
        type: 'JavaScript',
        url: `${assetGraph.root}index-precache-service-worker.js`,
        text: 'alert("hello");'
      })
    );

    expect(warnSpy, 'to have calls satisfying', () =>
      warnSpy(/^ENOENT.*notFound\.js/)
    );

    await expect(
      assetgraphWorkbox(assetGraph, { query: { isInitial: true } }),
      'to be rejected with',
      new Error(
        `There is already a service worker at ${assetGraph.root}index-precache-service-worker.js -- giving up`
      )
    );
  });

  describe('in single:true mode', function() {
    it('should add the same shared precache service worker to multiple pages', async function() {
      const assetGraph = new AssetGraph({
        root: pathModule.resolve(__dirname, '../testdata/multiPage/')
      });
      await assetGraph.loadAssets('*.html').populate();

      expect(assetGraph, 'to contain assets', 3);
      expect(assetGraph, 'to contain relations', 4);
      expect(assetGraph, 'to contain asset', 'Png');
      expect(assetGraph, 'to contain assets', 'Html', 2);
      expect(assetGraph, 'to contain relations', 'HtmlIFrame');
      expect(assetGraph, 'to contain relations', 'HtmlImage', 2);

      await assetgraphWorkbox(assetGraph, {
        query: { isInitial: true },
        single: true
      });

      expect(
        assetGraph,
        'to contain relation',
        'JavaScriptServiceWorkerRegistration',
        2
      );
      expect(assetGraph, 'to contain relations', 'JavaScriptStaticUrl', 3);
      expect(assetGraph, 'to contain relations', 'HtmlScript', 2);
      expect(assetGraph, 'to contain asset', {
        url: `${assetGraph.root}index-otherpage-precache-service-worker.js`
      });
      expect(
        assetGraph,
        'to contain relations',
        {
          to: { fileName: 'index-otherpage-precache-service-worker.js' }
        },
        2
      );
    });

    it('should only add one fragment to the service worker file name per unique basename', async function() {
      const assetGraph = new AssetGraph({
        root: pathModule.resolve(__dirname, '../testdata/multiPage/')
      });
      await assetGraph.loadAssets('*.html').populate();

      assetGraph.findAssets({
        fileName: 'otherpage.html'
      })[0].url = `${assetGraph.root}somewhereelse/index.html`;

      await assetgraphWorkbox(assetGraph, {
        query: { isInitial: true },
        single: true
      });

      expect(assetGraph, 'to contain asset', {
        url: `${assetGraph.root}index-precache-service-worker.js`
      });
    });

    it('should put the service worker at a common path prefix', async function() {
      const assetGraph = new AssetGraph({
        root: pathModule.resolve(
          __dirname,
          '../testdata/multiPageInDifferentDirectories/'
        )
      });
      await assetGraph.loadAssets('**/*.html').populate();

      expect(assetGraph, 'to contain assets', 3);
      expect(assetGraph, 'to contain relations', 2);
      expect(assetGraph, 'to contain asset', 'Png');
      expect(assetGraph, 'to contain assets', 'Html', 2);
      expect(assetGraph, 'to contain relations', 'HtmlImage', 2);

      await assetgraphWorkbox(assetGraph, {
        query: { isInitial: true },
        single: true
      });

      expect(
        assetGraph,
        'to contain relation',
        'JavaScriptServiceWorkerRegistration',
        2
      );
      expect(assetGraph, 'to contain relations', 'JavaScriptStaticUrl', 3);
      expect(assetGraph, 'to contain relations', 'HtmlScript', 2);
      expect(assetGraph, 'to contain asset', {
        url: `${assetGraph.root}path/to/index-otherpage-precache-service-worker.js`
      });
      expect(
        assetGraph,
        'to contain relations',
        {
          to: { fileName: 'index-otherpage-precache-service-worker.js' }
        },
        2
      );
    });

    it('should create multiple service workers when when the participating HTML assets reside on different schemes', async function() {
      const infoSpy = sinon.spy().named('info');
      const assetGraph = new AssetGraph({
        root: pathModule.resolve(__dirname, '../testdata/multiPage/')
      });
      await assetGraph
        .on('info', infoSpy)
        .loadAssets('*.html')
        .populate();

      assetGraph.findAssets({ fileName: 'index.html' })[0].url =
        'https://example.com/blah.html';

      await assetgraphWorkbox(assetGraph, {
        query: { isInitial: true },
        single: true
      });

      expect(assetGraph, 'to contain asset', {
        url: 'https://example.com/blah-precache-service-worker.js'
      });
      expect(assetGraph, 'to contain asset', {
        url: `${assetGraph.root}otherpage-precache-service-worker.js`
      });

      expect(infoSpy, 'to have a call satisfying', () =>
        infoSpy(
          new Error(
            'addPrecacheServiceWorker: HTML assets reside on different domains or schemes, creating a service worker per origin'
          )
        )
      );
    });

    it('should create multiple service workers when when the participating HTML assets reside on different hosts', async function() {
      const infoSpy = sinon.spy().named('info');
      const assetGraph = new AssetGraph({
        root: pathModule.resolve(__dirname, '../testdata/multiPage/')
      });
      await assetGraph
        .on('info', infoSpy)
        .loadAssets('*.html')
        .populate();

      assetGraph.findAssets({ fileName: 'index.html' })[0].url =
        'https://example.com/blah.html';
      assetGraph.findAssets({ fileName: 'otherpage.html' })[0].url =
        'https://yadda.com/foo.html';

      await assetgraphWorkbox(assetGraph, {
        query: { isInitial: true },
        single: true
      });

      expect(assetGraph, 'to contain asset', {
        url: 'https://example.com/blah-precache-service-worker.js'
      });
      expect(assetGraph, 'to contain asset', {
        url: 'https://yadda.com/foo-precache-service-worker.js'
      });

      expect(infoSpy, 'to have a call satisfying', () =>
        infoSpy(
          new Error(
            'addPrecacheServiceWorker: HTML assets reside on different domains or schemes, creating a service worker per origin'
          )
        )
      );
    });

    it('should respect a root-relative canonicalRoot', async function() {
      const assetGraph = new AssetGraph({
        root: pathModule.resolve(__dirname, '../testdata/multiPage/'),
        canonicalRoot: '/my-app'
      });
      const htmlAssets = await assetGraph.loadAssets('*.html');

      await assetGraph.populate();

      await assetgraphWorkbox(assetGraph, {
        query: { isInitial: true },
        single: true
      });

      expect(
        htmlAssets[0].text,
        'to contain',
        `navigator.serviceWorker.register('/my-app/index-otherpage-precache-service-worker.js');`
      );
      const serviceWorker = assetGraph.findAssets({
        fileName: 'index-otherpage-precache-service-worker.js'
      })[0];
      expect(
        serviceWorker.text,
        'to contain',
        `"/my-app/foo.png".toString('url')`
      );
    });
  });

  it('use a config at the canonical path if present', async function() {
    const assetGraph = new AssetGraph({
      root: pathModule.resolve(__dirname, '../testdata/customConfig/')
    });
    assetGraph.on('warn', () => {}); // Ignore cacheFirst deprecation warning (FIXME: Switch to the Workbox v4 syntax)
    await assetGraph.loadAssets('index.html').populate({
      followRelations: { to: { protocol: 'file:' } }
    });

    await assetgraphWorkbox(assetGraph, { query: { isInitial: true } });

    expect(
      assetGraph,
      'to contain relation',
      'JavaScriptServiceWorkerRegistration',
      1
    );
    const serviceWorker = assetGraph.findAssets({
      fileName: 'index-precache-service-worker.js'
    })[0];
    expect(serviceWorker.text, 'to contain', 'ag-test-url');
  });

  it('use a config at custom path if present', async function() {
    const root = pathModule.resolve(__dirname, '../testdata/customConfig/');
    const assetGraph = new AssetGraph({ root });
    assetGraph.on('warn', () => {}); // Ignore cacheFirst deprecation warning (FIXME: Switch to the Workbox v4 syntax)
    await assetGraph.loadAssets('index.html').populate({
      followRelations: { to: { protocol: 'file:' } }
    });

    await assetgraphWorkbox(assetGraph, {
      query: {
        isInitial: true
      },
      configPath: pathModule.resolve(root, 'custom-sw-precache-config.js')
    });

    expect(
      assetGraph,
      'to contain relation',
      'JavaScriptServiceWorkerRegistration',
      1
    );
    const serviceWorker = assetGraph.findAssets({
      fileName: 'index-precache-service-worker.js'
    })[0];
    expect(serviceWorker.text, 'to contain', 'ag-test-url-at-custom-path');
  });

  it('warn if config at custom path is not present', async function() {
    const warnSpy = sinon.spy().named('warn');
    const assetGraph = new AssetGraph({
      root: pathModule.resolve(__dirname, '../testdata/customConfig/')
    });
    await assetGraph
      .on('warn', warnSpy)
      .loadAssets('index.html')
      .populate({
        followRelations: { to: { protocol: 'file:' } }
      });

    await assetgraphWorkbox(assetGraph, {
      query: {
        isInitial: true
      },
      configPath: 'not-found-sw-precache-config.js'
    });

    expect(
      assetGraph,
      'to contain no relation',
      'JavaScriptServiceWorkerRegistration',
      1
    );
    expect(warnSpy, 'to have calls satisfying', () =>
      warnSpy(/not-found-sw-precache-config\.js/)
    );
  });

  it('should throw if the globPatterns option is given', async function() {
    const warnSpy = sinon.spy().named('warn');
    const assetGraph = new AssetGraph({
      root: pathModule.resolve(
        __dirname,
        '../testdata/customConfigWithGlobPatterns/'
      )
    });
    await assetGraph
      .on('warn', warnSpy)
      .loadAssets('index.html')
      .populate({
        followRelations: { to: { protocol: 'file:' } }
      });

    await expect(
      assetgraphWorkbox(assetGraph, {
        query: { isInitial: true }
      }),
      'to be rejected with',
      'The globPatterns config option is not supported at present, sorry!'
    );
  });
});

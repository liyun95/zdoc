// Request-time cloud-data fragment renderer for nginx njs (js_content).
//
// The `.md` artifacts carry SSI pairs baked by embed-markdown:
//   <!--# block name="…" -->(snapshot table)<!--# endblock -->
//   <!--# include virtual="/api/cloud-data/fragment.md?section=…&site=…" stub="…" -->
// nginx resolves the include here: subrequest the CMS JSON through the
// caching /api/cloud-json/ locations, adapt and render it with the SAME
// modules the build used (packages/docs-ui/src/shared/cloud-data), and serve
// text/markdown. Any failure returns an empty 200 so SSI falls back to the
// snapshot stub — the documented CMS-outage degradation.
//
// Site selection rides the include URL (`&site=en|zh-CN`) because the same
// image serves both sites and njs cannot read environment variables. The four
// hard constraints verified in ssi-local-test are encoded in the site confs:
// buffer >= JSON size, one proxy_pass hop before this location (an njs
// location cannot be an SSI include target directly), intercepted upstream
// errors, and the stub block preceding the include.

// njs only supports default imports; the core modules ship matching defaults.
import adapter from 'adapter.js';
import render from 'render.js';

async function fragment(r) {
  try {
    const site = r.args.site === 'zh-CN' ? 'zh-CN' : 'en';
    const section = r.args.section;
    if (!section) throw new Error('missing section argument');
    const provider = r.args.provider || undefined;

    const regionsResponse = await r.subrequest('/api/cloud-json/regions');
    if (regionsResponse.status !== 200) throw new Error('regions upstream ' + regionsResponse.status);
    let featuresJson = {data: []};
    if (section === 'features') {
      const featuresResponse = await r.subrequest('/api/cloud-json/features');
      if (featuresResponse.status !== 200) throw new Error('features upstream ' + featuresResponse.status);
      featuresJson = JSON.parse(featuresResponse.responseText);
    }
    const regionsJson = JSON.parse(regionsResponse.responseText);

    const model = adapter.buildModel(site, regionsJson, featuresJson);
    const markdown = render.renderFragment(model, {section: section, provider: provider});

    r.headersOut['Content-Type'] = 'text/markdown; charset=utf-8';
    r.return(200, markdown);
  } catch (error) {
    r.error('cloud-data fragment failed: ' + error);
    r.return(200, '');
  }
}

export default {fragment};

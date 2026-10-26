// Per-site vocabulary for the Zilliz Cloud CMS (Strapi v4) cloud data.
//
// The two production instances (en: cms.zilliz.cc, zh-CN: cms-cn.zilliz.cc)
// share a schema but not enum names: the Chinese instance stores Chinese
// display names for providers, compute types and deployments, and every row
// carries locale "en" — language is decided by the instance, not by a locale
// parameter. Until the CMS grows language-independent keys (spec §6-4), this
// module is the single mapping from CMS display names to stable keys.
//
// Runs in three places: the Node build (snapshot baking), nginx njs at request
// time (live .md fragments) and vitest. njs-compatible ESM only: no optional
// chaining, no nullish coalescing, no Map iteration, no Object.fromEntries.

const SITES = ['en', 'zh-CN'];

// Regions the service IPs table rows on (en "Service IPs" = us-west-2, zh =
// cn-hangzhou). Stand-in for the missing CMS `is_service_ip` marker (§6-3);
// delete together with this comment once the CMS adds the flag.
const SERVICE_IP_REGIONS = {en: 'us-west-2', 'zh-CN': 'cn-hangzhou'};

const VOCAB = {
  en: {
    providerKeys: {'AWS': 'aws', 'Google Cloud': 'gcp', 'Microsoft Azure': 'azure'},
    providerNames: {aws: 'AWS', gcp: 'Google Cloud', azure: 'Microsoft Azure'},
    order: ['aws', 'gcp', 'azure'],
    anchors: {aws: 'aws', gcp: 'google-cloud', azure: 'azure'},
    // Table region name / location column source attributes. The en page shows
    // the region ID plus a Location column; zh shows the Chinese name only.
    regionName: function (attributes) { return attributes.region_name; },
    regionLocation: function (attributes) { return attributes.location; },
    computeRows: [
      {cms: 'Serving cluster', label: 'Always-on compute (Serving cluster)', labelHtml: 'Always-on compute (<a href="./manage-cluster">Serving cluster</a>)'},
      {cms: 'On-demand compute', label: 'On-demand compute', href: './on-demand-cluster'},
    ],
    deployRows: [
      {cms: 'Free & Serverless', label: 'SaaS (Free & Serverless)'},
      {cms: 'Dedicated', label: 'SaaS (Dedicated)'},
      {cms: 'BYOC', label: 'BYOC'},
    ],
    byoc: 'BYOC',
    cellAll: ['✅ All listed regions'],
    cellNone: ['Not available'],
    contactPattern: '^ℹ️\\s*Contact us$',
    rowHeaders: {compute: 'Compute type', deploy: 'Deployment option', feature: 'Feature'},
  },
  'zh-CN': {
    providerKeys: {'阿里云': 'alibaba', '腾讯云': 'tencent', '亚马逊云科技': 'amazon-cn'},
    providerNames: {alibaba: '阿里云', tencent: '腾讯云', 'amazon-cn': '亚马逊云科技'},
    order: ['alibaba', 'tencent', 'amazon-cn'],
    anchors: {alibaba: 'alibaba-cloud', tencent: 'tencent-cloud', 'amazon-cn': 'amazon-cn'},
    regionName: function (attributes) { return attributes.location; },
    regionLocation: function () { return null; },
    computeRows: [
      {cms: 'Serving 集群', label: 'Serving 集群'},
      {cms: '按需计算', label: '按需计算'},
    ],
    deployRows: [
      {cms: 'Free 和 Serverless', label: 'SaaS（Free 和 Serverless）'},
      {cms: 'Dedicated', label: 'SaaS（Dedicated）'},
      {cms: 'BYOC', label: 'BYOC'},
    ],
    byoc: 'BYOC',
    cellAll: ['✅ 全部地域'],
    // The zh CMS writes `暂不支持` while the current live pages use `❌`; both
    // are recognised until the wording is settled (§2, §9-5).
    cellNone: ['暂不支持', '❌'],
    contactPattern: '^ℹ️\\s*请联系我们$',
    rowHeaders: {compute: '计算类型', deploy: '部署方式', feature: '功能'},
  },
};

function vocabFor(site) {
  const vocab = VOCAB[site];
  if (!vocab) throw new Error('Unsupported cloud-data site: ' + site);
  return vocab;
}

function serviceIpRegion(site) {
  const region = SERVICE_IP_REGIONS[site];
  if (!region) throw new Error('No service IP region configured for site: ' + site);
  return region;
}

// njs only supports default imports, so the nginx renderer consumes this
// default export while Node/React consumers use the named exports above.
export default {SITES, VOCAB, vocabFor, serviceIpRegion};

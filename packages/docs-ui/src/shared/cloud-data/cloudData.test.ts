import {describe, expect, it} from 'vitest';
import renderModule from './render.js';
import adapterModule from './adapter.js';

const {renderFragment, escapeText} = renderModule;
const {buildModel} = adapterModule;

// Golden fixtures transcribed verbatim from the four live pages
// (content/en + content/zh-CN cloud-providers-and-regions + zilliz-cloud-ips),
// and the exact fragment bytes the verified renderer of
// .claude/specs/2026-10-26-regionmatrix-markdown-template produced for them.
// Any diff here is a visible change to the live table layout.

// Data transcribed from the four live pages (content/en + content/zh-CN) so the
// renderer output can be diffed against them. ap-southeast-2 fixes the
// "ap-sourtheast-2" typo in the en IPs page.

const all = (extra?: string) => (extra ? {kind: 'all', extra} : {kind: 'all'});
const none = {kind: 'none'};
const contact = {kind: 'contact'};
const partial = (regions: string[], note?: string) => (note ? {kind: 'partial', regions, note} : {kind: 'partial', regions});

const en = {
  locale: 'en',
  updatedAt: '2026-10-26T00:00:00Z',
  providers: [
    {
      key: 'aws', name: 'AWS', anchor: 'aws',
      regions: [
        {continent: 'North America', name: 'us-west-2', location: 'Oregon, USA'},
        {continent: 'North America', name: 'us-east-1', location: 'N. Virginia, USA'},
        {continent: 'North America', name: 'us-east-2', location: 'Ohio, USA'},
        {continent: 'North America', name: 'ca-central-1', location: 'Canada (Central)'},
        {continent: 'Europe', name: 'eu-central-1', location: 'Frankfurt, Germany'},
        {continent: 'Europe', name: 'eu-west-1', location: 'Ireland'},
        {continent: 'Asia', name: 'ap-northeast-1', location: 'Tokyo, Japan'},
        {continent: 'Asia', name: 'ap-southeast-1', location: 'Singapore'},
        {continent: 'Asia', name: 'ap-northeast-2', location: 'Seoul, Korea'},
        {continent: 'Oceania', name: 'ap-southeast-2', location: 'Sydney, Australia'},
      ],
      ipRows: [
        {region: 'us-west-2', location: 'Oregon, USA', cidrs: ['54.200.111.111', '34.218.171.123']},
        {region: 'us-east-1', location: 'N. Virginia, USA', cidrs: ['44.208.236.92']},
        {region: 'us-east-2', location: 'Ohio, USA', cidrs: ['18.190.127.133']},
        {region: 'ap-southeast-1', location: 'Singapore', cidrs: ['13.251.167.154', '3.0.159.148']},
        {region: 'ap-northeast-1', location: 'Tokyo, Japan', cidrs: ['35.72.252.126']},
        {region: 'eu-central-1', location: 'Frankfurt, Germany', cidrs: ['18.158.52.65', '3.121.11.160']},
        {region: 'eu-west-1', location: 'Ireland', cidrs: ['54.76.194.38', '99.81.179.135', '3.248.62.149', '52.16.225.156']},
        {region: 'ca-central-1', location: 'Canada (Central)', cidrs: ['15.157.245.36', '52.60.120.239', '15.157.14.152']},
        {region: 'ap-southeast-2', location: 'Sydney, Australia', cidrs: ['13.210.191.123', '52.62.215.167']},
        {region: 'ap-northeast-2', location: 'Seoul, Korea', cidrs: ['43.200.197.223', '54.116.65.71', '43.200.30.237', '13.125.81.204']},
      ],
    },
    {
      key: 'gcp', name: 'Google Cloud', anchor: 'google-cloud',
      regions: [
        {continent: 'North America', name: 'us-west1', location: 'Oregon, USA'},
        {continent: 'North America', name: 'us-east4', location: 'Virginia, USA'},
        {continent: 'North America', name: 'us-central1', location: 'Iowa, USA'},
        {continent: 'Europe', name: 'europe-west3', location: 'Frankfurt, Germany'},
        {continent: 'Asia', name: 'asia-southeast1', location: 'Singapore'},
        {continent: 'Asia', name: 'asia-northeast1', location: 'Tokyo, Japan'},
      ],
      ipRows: [
        {region: 'us-west1', location: 'Oregon, USA', cidrs: ['34.168.252.102', '34.83.176.23', '35.247.80.67', '35.227.139.83', '34.168.123.225', '35.247.17.192', '34.105.17.34']},
        {region: 'us-east4', location: 'Virginia, USA', cidrs: ['35.245.190.186', '35.245.51.241']},
        {region: 'us-central1', location: 'Iowa, USA', cidrs: ['34.49.219.2', '34.98.66.206', '35.190.6.159', '34.149.186.202']},
        {region: 'asia-southeast1', location: 'Singapore', cidrs: ['34.87.102.210', '35.197.139.186']},
        {region: 'europe-west3', location: 'Frankfurt, Germany', cidrs: ['34.107.41.158', '34.141.61.171']},
      ],
    },
    {
      key: 'azure', name: 'Microsoft Azure', anchor: 'azure',
      regions: [
        {continent: 'North America', name: 'East US', location: 'Virginia, USA'},
        {continent: 'North America', name: 'East US 2', location: 'Virginia, USA'},
        {continent: 'North America', name: 'Central US', location: 'Iowa, USA'},
        {continent: 'Europe', name: 'Germany West Central', location: 'Frankfurt, Germany'},
        {continent: 'Europe', name: 'North Europe', location: 'Ireland'},
        {continent: 'Asia', name: 'Central India', location: 'Pune, India'},
      ],
      ipRows: [
        {region: 'East US', location: 'Virginia, USA', cidrs: ['52.152.137.114']},
        {region: 'East US 2', location: 'Virginia, USA', cidrs: ['135.18.170.251']},
        {region: 'Central US', location: 'Iowa, USA', cidrs: ['52.173.197.113']},
        {region: 'Germany West Central', location: 'Frankfurt, Germany', cidrs: ['4.184.247.193']},
        {region: 'North Europe', location: 'Ireland', cidrs: ['4.207.64.80', '13.79.36.108']},
        {region: 'Central India', location: 'Pune, India', cidrs: ['98.70.222.135']},
      ],
    },
  ],
  serviceIps: [
    {region: 'us-west-2', location: 'Oregon, USA', cidrs: ['54.200.111.111', '34.218.171.123']},
  ],
  matrices: {
    'compute-types': {
      key: 'compute-types', rowHeader: 'Compute type',
      rows: [
        {labelHtml: 'Always-on compute (<a href="./manage-cluster">Serving cluster</a>)', label: 'Always-on compute (Serving cluster)', cells: {aws: all(), gcp: all(), azure: all()}},
        {label: 'On-demand compute', href: './on-demand-cluster', cells: {aws: all(), gcp: none, azure: partial(['East US'])}},
      ],
    },
    'deployment-options': {
      key: 'deployment-options', rowHeader: 'Deployment option',
      rows: [
        {label: 'SaaS (Free & Serverless)', cells: {aws: partial(['eu-central-1', 'eu-west-1']), gcp: partial(['us-west1']), azure: none}},
        {label: 'SaaS (Dedicated)', cells: {aws: all(), gcp: all(), azure: all()}},
        {label: 'BYOC', cells: {aws: all('ap-east-1 (Hong Kong SAR)'), gcp: all(), azure: all()}},
      ],
    },
    features: {
      key: 'features', rowHeader: 'Feature',
      rows: [
        {label: 'Volume', href: './managed-volume', cells: {aws: all(), gcp: all(), azure: none}},
        {label: 'External collection', href: './manage-external-collections-console', cells: {aws: all(), gcp: none, azure: none}},
        {label: 'Global cluster', href: './global-cluster-explained', cells: {aws: all(), gcp: partial(['gcp-us-central1', 'gcp-us-east4'], '[Contact us](http://support.zilliz.com) if you need to use this feature in Google Cloud regions.'), azure: none}},
        {label: 'Cross-region backup', href: './backup-to-other-regions', cells: {aws: all(), gcp: all(), azure: none}},
        {label: 'CMEK', href: './cmek', cells: {aws: all(), gcp: none, azure: none}},
      ],
    },
  },
};

const zh = {
  locale: 'zh-CN',
  updatedAt: '2026-10-26T00:00:00Z',
  providers: [
    {
      key: 'alibaba', name: '阿里云', anchor: 'alibaba-cloud',
      regions: [
        {continent: '中国内地', name: '华东1（杭州）'},
        {continent: '中国内地', name: '华东2（上海）'},
        {continent: '中国内地', name: '华北2（北京）'},
        {continent: '中国内地', name: '华南1（深圳）'},
        {continent: '北美', name: '美国（弗吉尼亚）'},
        {continent: '亚太', name: '新加坡'},
        {continent: '中东', name: '沙特（利雅得-合作伙伴运营）'},
      ],
      ipRows: [
        {region: 'cn-hangzhou', location: '华东1（杭州）', cidrs: ['114.55.232.32']},
        {region: 'cn-beijing', location: '华北2（北京）', cidrs: ['39.105.24.167']},
        {region: 'cn-shenzhen', location: '华南1（深圳）', cidrs: ['47.107.39.14']},
        {region: 'cn-shanghai', location: '华东2（上海）', cidrs: ['47.117.150.202']},
        {region: 'us-east', location: '美国（弗吉尼亚）', cidrs: ['47.253.55.20']},
        {region: 'ap-southeast-1', location: '新加坡', cidrs: ['47.237.71.220']},
      ],
    },
    {
      key: 'tencent', name: '腾讯云', anchor: 'tencent-cloud',
      regions: [
        {continent: '中国内地', name: '华北地区（北京）'},
        {continent: '中国内地', name: '华东地区（上海）'},
        {continent: '北美', name: '美国东部（弗吉尼亚）'},
      ],
      ipRows: [
        {region: 'ap-beijing', location: '华北地区（北京）', cidrs: ['82.156.105.162']},
        {region: 'ap-shanghai', location: '华东地区（上海）', cidrs: ['124.222.234.127']},
        {region: 'na-ashburn', location: '美国东部（弗吉尼亚）', cidrs: ['43.130.121.239']},
      ],
    },
    {
      key: 'amazon-cn', name: '亚马逊云科技', anchor: 'amazon-cn',
      regions: [{continent: '中国内地', name: '中国（宁夏）'}],
      ipRows: [{region: 'cn-northwest-1', location: '中国（宁夏）', cidrs: ['43.192.24.37']}],
    },
  ],
  serviceIps: [{region: 'cn-hangzhou', location: '华东1（杭州）', cidrs: ['114.55.232.32']}],
  matrices: {
    'compute-types': {
      key: 'compute-types', rowHeader: '计算类型',
      rows: [
        {label: 'Serving 集群', cells: {alibaba: all(), tencent: all(), 'amazon-cn': all()}},
        {label: '按需计算', cells: {alibaba: all(), tencent: none, 'amazon-cn': none}},
      ],
    },
    'deployment-options': {
      key: 'deployment-options', rowHeader: '部署方式',
      rows: [
        {label: 'SaaS（Free 和 Serverless）', cells: {alibaba: partial(['华东1（杭州）']), tencent: none, 'amazon-cn': none}},
        {label: 'SaaS（Dedicated）', cells: {alibaba: all(), tencent: all(), 'amazon-cn': all()}},
        {label: 'BYOC', cells: {alibaba: all(), tencent: all(), 'amazon-cn': all()}},
      ],
    },
    features: {
      key: 'features', rowHeader: '功能',
      rows: [
        {label: 'Volume', cells: {alibaba: all(), tencent: none, 'amazon-cn': all()}},
        {label: 'External Collection', cells: {alibaba: all(), tencent: none, 'amazon-cn': none}},
        {label: 'Global Cluster（全球集群）', cells: {alibaba: contact, tencent: contact, 'amazon-cn': contact}},
        {label: 'Cross-region backup（跨地域备份）', cells: {alibaba: all(), tencent: none, 'amazon-cn': all()}},
        {label: '托管模型', cells: {alibaba: partial(['华北2（北京）']), tencent: none, 'amazon-cn': none}},
        {label: '导出备份文件', cells: {alibaba: all(), tencent: none, 'amazon-cn': all()}},
      ],
    },
  },
};

// Golden fragment lines per section request.
export const enRegionsAws = [
"<table>",
"   <tr>",
"     <th><p><strong>Continent</strong></p></th>",
"     <th><p><strong>Region</strong></p></th>",
"     <th><p><strong>Location</strong></p></th>",
"   </tr>",
"   <tr>",
"     <td rowspan=\"4\"><p>North America</p></td>",
"     <td><p>us-west-2</p></td>",
"     <td><p>Oregon, USA</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>us-east-1</p></td>",
"     <td><p>N. Virginia, USA</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>us-east-2</p></td>",
"     <td><p>Ohio, USA</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>ca-central-1</p></td>",
"     <td><p>Canada (Central)</p></td>",
"   </tr>",
"   <tr>",
"     <td rowspan=\"2\"><p>Europe</p></td>",
"     <td><p>eu-central-1</p></td>",
"     <td><p>Frankfurt, Germany</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>eu-west-1</p></td>",
"     <td><p>Ireland</p></td>",
"   </tr>",
"   <tr>",
"     <td rowspan=\"3\"><p>Asia</p></td>",
"     <td><p>ap-northeast-1</p></td>",
"     <td><p>Tokyo, Japan</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>ap-southeast-1</p></td>",
"     <td><p>Singapore</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>ap-northeast-2</p></td>",
"     <td><p>Seoul, Korea</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>Oceania</p></td>",
"     <td><p>ap-southeast-2</p></td>",
"     <td><p>Sydney, Australia</p></td>",
"   </tr>",
"</table>",
];

export const enRegionsGcp = [
"<table>",
"   <tr>",
"     <th><p><strong>Continent</strong></p></th>",
"     <th><p><strong>Region</strong></p></th>",
"     <th><p><strong>Location</strong></p></th>",
"   </tr>",
"   <tr>",
"     <td rowspan=\"3\"><p>North America</p></td>",
"     <td><p>us-west1</p></td>",
"     <td><p>Oregon, USA</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>us-east4</p></td>",
"     <td><p>Virginia, USA</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>us-central1</p></td>",
"     <td><p>Iowa, USA</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>Europe</p></td>",
"     <td><p>europe-west3</p></td>",
"     <td><p>Frankfurt, Germany</p></td>",
"   </tr>",
"   <tr>",
"     <td rowspan=\"2\"><p>Asia</p></td>",
"     <td><p>asia-southeast1</p></td>",
"     <td><p>Singapore</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>asia-northeast1</p></td>",
"     <td><p>Tokyo, Japan</p></td>",
"   </tr>",
"</table>",
];

export const enRegionsAzure = [
"<table>",
"   <tr>",
"     <th><p><strong>Continent</strong></p></th>",
"     <th><p><strong>Region</strong></p></th>",
"     <th><p><strong>Location</strong></p></th>",
"   </tr>",
"   <tr>",
"     <td rowspan=\"3\"><p>North America</p></td>",
"     <td><p>East US</p></td>",
"     <td><p>Virginia, USA</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>East US 2</p></td>",
"     <td><p>Virginia, USA</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>Central US</p></td>",
"     <td><p>Iowa, USA</p></td>",
"   </tr>",
"   <tr>",
"     <td rowspan=\"2\"><p>Europe</p></td>",
"     <td><p>Germany West Central</p></td>",
"     <td><p>Frankfurt, Germany</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>North Europe</p></td>",
"     <td><p>Ireland</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>Asia</p></td>",
"     <td><p>Central India</p></td>",
"     <td><p>Pune, India</p></td>",
"   </tr>",
"</table>",
];

export const enComputeTypes = [
"<table>",
"   <tr>",
"     <th><p><strong>Compute type</strong></p></th>",
"     <th><p><strong>AWS</strong></p></th>",
"     <th><p><strong>Google Cloud</strong></p></th>",
"     <th><p><strong>Microsoft Azure</strong></p></th>",
"   </tr>",
"   <tr>",
"     <td><p>Always-on compute (<a href=\"./manage-cluster\">Serving cluster</a>)</p></td>",
"     <td><p>✅ All regions</p></td>",
"     <td><p>✅ All regions</p></td>",
"     <td><p>✅ All regions</p></td>",
"   </tr>",
"   <tr>",
"     <td><p><a href=\"./on-demand-cluster\">On-demand compute</a></p></td>",
"     <td><p>✅ All regions</p></td>",
"     <td><p>❌</p></td>",
"     <td><p>ℹ️ Part of the regions:</p><ul><li>East US</li></ul></td>",
"   </tr>",
"</table>",
];

export const enDeploymentOptions = [
"<table>",
"   <tr>",
"     <th><p><strong>Deployment option</strong></p></th>",
"     <th><p><strong>AWS</strong></p></th>",
"     <th><p><strong>Google Cloud</strong></p></th>",
"     <th><p><strong>Microsoft Azure</strong></p></th>",
"   </tr>",
"   <tr>",
"     <td><p>SaaS (Free & Serverless)</p></td>",
"     <td><p>ℹ️ Part of the regions:</p><ul><li>eu-central-1</li><li>eu-west-1</li></ul></td>",
"     <td><p>ℹ️ Part of the regions:</p><ul><li>us-west1</li></ul></td>",
"     <td><p>❌</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>SaaS (Dedicated)</p></td>",
"     <td><p>✅ All regions</p></td>",
"     <td><p>✅ All regions</p></td>",
"     <td><p>✅ All regions</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>BYOC</p></td>",
"     <td><p>✅ All regions</p><p>Plus ap-east-1 (Hong Kong SAR)</p></td>",
"     <td><p>✅ All regions</p></td>",
"     <td><p>✅ All regions</p></td>",
"   </tr>",
"</table>",
];

export const enFeatures = [
"<table>",
"   <tr>",
"     <th><p><strong>Feature</strong></p></th>",
"     <th><p><strong>AWS</strong></p></th>",
"     <th><p><strong>Google Cloud</strong></p></th>",
"     <th><p><strong>Microsoft Azure</strong></p></th>",
"   </tr>",
"   <tr>",
"     <td><p><a href=\"./managed-volume\">Volume</a></p></td>",
"     <td><p>✅ All regions</p></td>",
"     <td><p>✅ All regions</p></td>",
"     <td><p>❌</p></td>",
"   </tr>",
"   <tr>",
"     <td><p><a href=\"./manage-external-collections-console\">External collection</a></p></td>",
"     <td><p>✅ All regions</p></td>",
"     <td><p>❌</p></td>",
"     <td><p>❌</p></td>",
"   </tr>",
"   <tr>",
"     <td><p><a href=\"./global-cluster-explained\">Global cluster</a></p></td>",
"     <td><p>✅ All regions</p></td>",
"     <td><p>ℹ️ Part of the regions:</p><ul><li>gcp-us-central1</li><li>gcp-us-east4</li></ul> <Admonition type=\"info\" icon=\"📘\" title=\"Note\"> [Contact us](http://support.zilliz.com) if you need to use this feature in Google Cloud regions. </Admonition></td>",
"     <td><p>❌</p></td>",
"   </tr>",
"   <tr>",
"     <td><p><a href=\"./backup-to-other-regions\">Cross-region backup</a></p></td>",
"     <td><p>✅ All regions</p></td>",
"     <td><p>✅ All regions</p></td>",
"     <td><p>❌</p></td>",
"   </tr>",
"   <tr>",
"     <td><p><a href=\"./cmek\">CMEK</a></p></td>",
"     <td><p>✅ All regions</p></td>",
"     <td><p>❌</p></td>",
"     <td><p>❌</p></td>",
"   </tr>",
"</table>",
];

export const enServiceIps = [
"| Region | Location | IP Addresses (CIDR) |",
"| --- | --- | --- |",
"| us-west-2 | Oregon, USA | `54.200.111.111`, `34.218.171.123` |",
];

export const enRegionIpsAws = [
"| Region | Location | IP Addresses (CIDR) |",
"| --- | --- | --- |",
"| us-west-2 | Oregon, USA | `54.200.111.111`, `34.218.171.123` |",
"| us-east-1 | N. Virginia, USA | `44.208.236.92` |",
"| us-east-2 | Ohio, USA | `18.190.127.133` |",
"| ap-southeast-1 | Singapore | `13.251.167.154`, `3.0.159.148` |",
"| ap-northeast-1 | Tokyo, Japan | `35.72.252.126` |",
"| eu-central-1 | Frankfurt, Germany | `18.158.52.65`, `3.121.11.160` |",
"| eu-west-1 | Ireland | `54.76.194.38`, `99.81.179.135`, `3.248.62.149`, `52.16.225.156` |",
"| ca-central-1 | Canada (Central) | `15.157.245.36`, `52.60.120.239`, `15.157.14.152` |",
"| ap-southeast-2 | Sydney, Australia | `13.210.191.123`, `52.62.215.167` |",
"| ap-northeast-2 | Seoul, Korea | `43.200.197.223`, `54.116.65.71`, `43.200.30.237`, `13.125.81.204` |",
];

export const zhRegionsAlibaba = [
"<table>",
"   <tr>",
"     <th><p><strong>大洲</strong></p></th>",
"     <th><p><strong>地域名称</strong></p></th>",
"   </tr>",
"   <tr>",
"     <td rowspan=\"4\"><p>中国内地</p></td>",
"     <td><p>华东1（杭州）</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>华东2（上海）</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>华北2（北京）</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>华南1（深圳）</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>北美</p></td>",
"     <td><p>美国（弗吉尼亚）</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>亚太</p></td>",
"     <td><p>新加坡</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>中东</p></td>",
"     <td><p>沙特（利雅得-合作伙伴运营）</p></td>",
"   </tr>",
"</table>",
];

export const zhRegionsTencent = [
"<table>",
"   <tr>",
"     <th><p><strong>大洲</strong></p></th>",
"     <th><p><strong>地域名称</strong></p></th>",
"   </tr>",
"   <tr>",
"     <td rowspan=\"2\"><p>中国内地</p></td>",
"     <td><p>华北地区（北京）</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>华东地区（上海）</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>北美</p></td>",
"     <td><p>美国东部（弗吉尼亚）</p></td>",
"   </tr>",
"</table>",
];

export const zhRegionsAmazon = [
"| 大洲 | 地域名称 |",
"| --- | --- |",
"| 中国内地 | 中国（宁夏） |",
];

export const zhComputeTypes = [
"| 计算类型 | 阿里云 | 腾讯云 | 亚马逊云科技 |",
"| --- | --- | --- | --- |",
"| Serving 集群 | ✅ 全部地域 | ✅ 全部地域 | ✅ 全部地域 |",
"| 按需计算 | ✅ 全部地域 | ❌ | ❌ |",
];

export const zhDeploymentOptions = [
"<table>",
"   <tr>",
"     <th><p><strong>部署方式</strong></p></th>",
"     <th><p><strong>阿里云</strong></p></th>",
"     <th><p><strong>腾讯云</strong></p></th>",
"     <th><p><strong>亚马逊云科技</strong></p></th>",
"   </tr>",
"   <tr>",
"     <td><p>SaaS（Free 和 Serverless）</p></td>",
"     <td><p>ℹ️ 部分地域：</p><ul><li>华东1（杭州）</li></ul></td>",
"     <td><p>❌</p></td>",
"     <td><p>❌</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>SaaS（Dedicated）</p></td>",
"     <td><p>✅ 全部地域</p></td>",
"     <td><p>✅ 全部地域</p></td>",
"     <td><p>✅ 全部地域</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>BYOC</p></td>",
"     <td><p>✅ 全部地域</p></td>",
"     <td><p>✅ 全部地域</p></td>",
"     <td><p>✅ 全部地域</p></td>",
"   </tr>",
"</table>",
];

export const zhFeatures = [
"<table>",
"   <tr>",
"     <th><p><strong>功能</strong></p></th>",
"     <th><p><strong>阿里云</strong></p></th>",
"     <th><p><strong>腾讯云</strong></p></th>",
"     <th><p><strong>亚马逊云科技</strong></p></th>",
"   </tr>",
"   <tr>",
"     <td><p>Volume</p></td>",
"     <td><p>✅ 全部地域</p></td>",
"     <td><p>❌</p></td>",
"     <td><p>✅ 全部地域</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>External Collection</p></td>",
"     <td><p>✅ 全部地域</p></td>",
"     <td><p>❌</p></td>",
"     <td><p>❌</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>Global Cluster（全球集群）</p></td>",
"     <td><p>ℹ️ 请联系我们</p></td>",
"     <td><p>ℹ️ 请联系我们</p></td>",
"     <td><p>ℹ️ 请联系我们</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>Cross-region backup（跨地域备份）</p></td>",
"     <td><p>✅ 全部地域</p></td>",
"     <td><p>❌</p></td>",
"     <td><p>✅ 全部地域</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>托管模型</p></td>",
"     <td><p>ℹ️ 部分地域：</p><ul><li>华北2（北京）</li></ul></td>",
"     <td><p>❌</p></td>",
"     <td><p>❌</p></td>",
"   </tr>",
"   <tr>",
"     <td><p>导出备份文件</p></td>",
"     <td><p>✅ 全部地域</p></td>",
"     <td><p>❌</p></td>",
"     <td><p>✅ 全部地域</p></td>",
"   </tr>",
"</table>",
];

export const zhServiceIps = [
"| 云地域 | 位置 | IP 地址（CIDR） |",
"| --- | --- | --- |",
"| cn-hangzhou | 华东1（杭州） | `114.55.232.32` |",
];

export const zhRegionIpsAlibaba = [
"| 云地域 | 位置 | IP 地址（CIDR） |",
"| --- | --- | --- |",
"| cn-hangzhou | 华东1（杭州） | `114.55.232.32` |",
"| cn-beijing | 华北2（北京） | `39.105.24.167` |",
"| cn-shenzhen | 华南1（深圳） | `47.107.39.14` |",
"| cn-shanghai | 华东2（上海） | `47.117.150.202` |",
"| us-east | 美国（弗吉尼亚） | `47.253.55.20` |",
"| ap-southeast-1 | 新加坡 | `47.237.71.220` |",
];


function fragment(lines: string[]): string {
  return lines.join('\n');
}

const CASES: Array<[string, any, {section: string; provider?: string}]> = [
  ['enRegionsAws', en, {section: 'regions', provider: 'aws'}],
  ['enRegionsGcp', en, {section: 'regions', provider: 'gcp'}],
  ['enRegionsAzure', en, {section: 'regions', provider: 'azure'}],
  ['enComputeTypes', en, {section: 'compute-types'}],
  ['enDeploymentOptions', en, {section: 'deployment-options'}],
  ['enFeatures', en, {section: 'features'}],
  ['enServiceIps', en, {section: 'service-ips'}],
  ['enRegionIpsAws', en, {section: 'region-ips', provider: 'aws'}],
  ['zhRegionsAlibaba', zh, {section: 'regions', provider: 'alibaba'}],
  ['zhRegionsTencent', zh, {section: 'regions', provider: 'tencent'}],
  ['zhRegionsAmazon', zh, {section: 'regions', provider: 'amazon-cn'}],
  ['zhComputeTypes', zh, {section: 'compute-types'}],
  ['zhDeploymentOptions', zh, {section: 'deployment-options'}],
  ['zhFeatures', zh, {section: 'features'}],
  ['zhServiceIps', zh, {section: 'service-ips'}],
  ['zhRegionIpsAlibaba', zh, {section: 'region-ips', provider: 'alibaba'}],
];

const GOLDENS: Record<string, string[]> = {
  enRegionsAws, enRegionsGcp, enRegionsAzure, enComputeTypes, enDeploymentOptions,
  enFeatures, enServiceIps, enRegionIpsAws, zhRegionsAlibaba, zhRegionsTencent,
  zhRegionsAmazon, zhComputeTypes, zhDeploymentOptions, zhFeatures, zhServiceIps,
  zhRegionIpsAlibaba,
};

describe('render.js golden fragments', () => {
  for (const [name, model, request] of CASES) {
    it(`reproduces the live-page fragment for ${name}`, () => {
      expect(renderFragment(model, request)).toBe(fragment(GOLDENS[name as keyof typeof GOLDENS]));
    });
  }
});

describe('render.js guards', () => {
  it('escapes MDX-unsafe characters in text', () => {
    expect(escapeText('<a>{x}</a>')).toBe('&lt;a&gt;\\{x\\}&lt;/a&gt;');
  });

  it('fails closed when a provider has no regions', () => {
    expect(() => renderFragment({locale: 'en', providers: [], matrices: {}} as any, {section: 'regions', provider: 'aws'})).toThrow();
  });

  it('fails closed on an unknown section', () => {
    expect(() => renderFragment(en as any, {section: 'nope'} as any)).toThrow('Unknown section');
  });
});

describe('adapter.js over CMS JSON', () => {
  const regionsJson = {
    data: [
      {attributes: {
        region_name: 'us-west-2', location: 'Oregon, USA', ip: '54.200.111.111, 34.218.171.123',
        provider: {data: {attributes: {name: 'AWS'}}},
        continent: {data: {attributes: {name: 'North America'}}},
        supported_deployments: {data: [{attributes: {name: 'Dedicated'}}, {attributes: {name: 'BYOC'}}]},
        supported_compute_types: {data: [{attributes: {name: 'Serving cluster'}}]},
        updatedAt: '2026-10-26T00:00:00Z'}},
      // BYOC-only region: must be excluded from tables and become a footnote.
      {attributes: {
        region_name: 'ap-east-1', location: 'Hong Kong SAR', ip: null,
        provider: {data: {attributes: {name: 'AWS'}}},
        continent: {data: {attributes: {name: 'Asia'}}},
        supported_deployments: {data: [{attributes: {name: 'BYOC'}}]},
        supported_compute_types: {data: []},
        updatedAt: '2026-10-26T00:00:00Z'}},
    ],
  };
  const featuresJson = {
    data: [
      {attributes: {
        name: 'CMEK',
        links: 'https://zilliverse.feishu.cn/wiki/internal-token',
        region_availability: [
          {cloud_provider: {data: {attributes: {name: 'AWS'}}}, supported_regions: '✅ All listed regions'},
          {cloud_provider: {data: {attributes: {name: 'Google Cloud'}}}, supported_regions: 'Available on [request](https://support.zilliz.com/) in:\n\n- `us-central1`'},
          {cloud_provider: {data: {attributes: {name: 'Microsoft Azure'}}}, supported_regions: 'Not available'},
        ]}},
      {attributes: {
        name: 'Volume',
        links: 'https://docs.zilliz.com/docs/managed-volume',
        region_availability: [
          {cloud_provider: {data: {attributes: {name: 'AWS'}}}, supported_regions: '✅ All listed regions'},
          {cloud_provider: {data: {attributes: {name: 'Google Cloud'}}}, supported_regions: '✅ All listed regions'},
          {cloud_provider: {data: {attributes: {name: 'Microsoft Azure'}}}, supported_regions: 'Not available'},
        ]}},
    ],
  };

  const model = buildModel('en', regionsJson as any, featuresJson as any);

  it('derives listed regions and excludes BYOC-only ones', () => {
    const aws = model.providers.find((provider) => provider.key === 'aws');
    expect(aws?.regions.map((region) => region.name)).toEqual(['us-west-2']);
  });

  it('keeps BYOC-only regions only as the BYOC cell footnote', () => {
    const byocRow = model.matrices['deployment-options'].rows.find((row) => row.label === 'BYOC');
    expect(byocRow?.cells.aws).toEqual({kind: 'all', extra: 'ap-east-1 (Hong Kong SAR)'});
  });

  it('parses the comma-separated `ip` string into CIDR arrays', () => {
    const aws = model.providers.find((provider) => provider.key === 'aws');
    expect(aws?.ipRows).toEqual([{region: 'us-west-2', location: 'Oregon, USA', cidrs: ['54.200.111.111', '34.218.171.123']}]);
    expect(model.serviceIps.map((row) => row.region)).toEqual(['us-west-2']);
  });

  it('recognizes CMS cell constants and applies the feature link policy', () => {
    const rows = model.matrices.features.rows;
    expect(rows[0].label).toBe('CMEK');
    // The internal Feishu wiki link is demoted; docs links become root-relative.
    expect(rows[0].href).toBeUndefined();
    expect(rows[1].href).toBe('/docs/managed-volume');
    expect(rows[0].cells.aws).toEqual({kind: 'all'});
    expect(rows[0].cells.gcp).toEqual({kind: 'text', text: 'Available on [request](https://support.zilliz.com/) in:\n\n- `us-central1`'});
    expect(rows[0].cells.azure).toEqual({kind: 'none'});
  });
});

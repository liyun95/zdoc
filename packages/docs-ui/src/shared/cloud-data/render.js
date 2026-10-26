// Pure renderer: normalized cloud-data model -> markdown fragment strings.
// No CMS, no filesystem. The same fragment is used for three consumers:
//   - the build-time snapshot bake inside `.md` artifacts (SSI stub blocks);
//   - the browser React table (renderReact.tsx renders the same model in JSX —
//     golden tests keep both layouts identical);
//   - vitest goldens locked to the live pages.
//
// Table grammar (verified verbatim against the four live pages by the
// 2026-10-26-regionmatrix-markdown-template research): HTML tables when rows
// need rowspan or rich cells, GFM when every cell is plain text.
//
// njs-compatible ESM (see vocab.js): no optional chaining/nullish/Map/for-of.

import stringsModule from './strings.js';

const stringsFor = stringsModule.stringsFor;

// MDX-safe inline text: a bare `<` opens JSX and `{`/`}` open an expression.
// `&` is left alone on purpose: the pages already contain "Free & Serverless".
function escapeText(value) {
  return String(value)
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}');
}

function escapeAttr(value) {
  return escapeText(value).replace(/"/g, '&quot;');
}

function escapeCell(value) {
  return escapeText(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br/>');
}

const p = function (html) { return '<p>' + html + '</p>'; };

function htmlTable(headers, rows) {
  const lines = ['<table>', '   <tr>'];
  for (let index = 0; index < headers.length; index += 1) {
    lines.push('     <th><p><strong>' + escapeText(headers[index]) + '</strong></p></th>');
  }
  lines.push('   </tr>');
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const cells = rows[rowIndex];
    lines.push('   <tr>');
    for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
      const cell = cells[cellIndex];
      const rowspan = cell.rowspan > 1 ? ' rowspan="' + cell.rowspan + '"' : '';
      lines.push('     <td' + rowspan + '>' + cell.html + '</td>');
    }
    lines.push('   </tr>');
  }
  lines.push('</table>');
  return lines.join('\n');
}

function gfmTable(headers, rows) {
  const line = function (cells) { return '| ' + cells.join(' | ') + ' |'; };
  const separator = headers.map(function () { return '---'; });
  const body = [];
  for (let index = 0; index < rows.length; index += 1) body.push(line(rows[index]));
  return [line(headers), line(separator)].concat(body).join('\n');
}

function groupByContinent(regions) {
  const order = [];
  const groups = {};
  for (let index = 0; index < regions.length; index += 1) {
    const region = regions[index];
    if (!groups[region.continent]) {
      groups[region.continent] = [];
      order.push(region.continent);
    }
    groups[region.continent].push(region);
  }
  const result = [];
  for (let index = 0; index < order.length; index += 1) result.push(groups[order[index]]);
  return result;
}

function renderRegionsTable(provider, strings) {
  if (!provider.regions || provider.regions.length === 0) {
    throw new Error('Provider ' + provider.key + ' has no regions');
  }
  let hasLocation = false;
  for (let index = 0; index < provider.regions.length; index += 1) {
    if (provider.regions[index].location) hasLocation = true;
  }
  const headers = hasLocation ? strings.regionColumns : strings.regionColumns.slice(0, 2);
  const groups = groupByContinent(provider.regions);
  let needsRowspan = false;
  for (let index = 0; index < groups.length; index += 1) {
    if (groups[index].length > 1) needsRowspan = true;
  }
  if (!needsRowspan) {
    return gfmTable(headers, provider.regions.map(function (region) {
      const cells = [region.continent, region.name];
      if (hasLocation) cells.push(region.location || '');
      return cells.map(escapeCell);
    }));
  }
  const rows = [];
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    for (let index = 0; index < group.length; index += 1) {
      const region = group[index];
      const cells = [];
      if (index === 0) {
        cells.push({html: p(escapeText(region.continent)), rowspan: group.length});
      }
      cells.push({html: p(escapeText(region.name))});
      if (hasLocation) cells.push({html: p(escapeText(region.location || ''))});
      rows.push(cells);
    }
  }
  return htmlTable(headers, rows);
}

function isPlainAvailability(cell) {
  if (cell.kind === 'none' || cell.kind === 'contact') return true;
  return cell.kind === 'all' && !cell.extra && !cell.note;
}

function availabilityText(cell, strings) {
  switch (cell.kind) {
    case 'all': return strings.all;
    case 'none': return strings.none;
    case 'contact': return strings.contact;
    case 'text': return escapeCell(cell.text);
    default: throw new Error('Unknown availability kind: ' + cell.kind);
  }
}

function availabilityHtml(cell, strings) {
  const note = cell.note
    ? ' <Admonition type="info" icon="📘" title="' + escapeAttr(strings.noteTitle) + '"> ' + cell.note + ' </Admonition>'
    : '';
  switch (cell.kind) {
    case 'all':
      return p(strings.all)
        + (cell.extra ? p(escapeText(strings.plus(cell.extra))) : '')
        + note;
    case 'none':
    case 'contact':
      return p(availabilityText(cell, strings)) + note;
    case 'partial': {
      if (!cell.regions || cell.regions.length === 0) {
        throw new Error('partial availability requires a non-empty regions list');
      }
      const items = [];
      for (let index = 0; index < cell.regions.length; index += 1) {
        items.push('<li>' + escapeText(cell.regions[index]) + '</li>');
      }
      return p(strings.partial) + '<ul>' + items.join('') + '</ul>' + note;
    }
    case 'text': {
      // Free-text CMS cells carry markdown. The `.md` consumers want it
      // verbatim (machines read the markdown source), so only the characters
      // that would break out of the cell are escaped.
      return p(escapeCell(cell.text)) + note;
    }
    default:
      throw new Error('Unknown availability kind: ' + cell.kind);
  }
}

function rowLabelHtml(row) {
  if (row.labelHtml) return row.labelHtml;
  const label = escapeText(row.label);
  if (!row.href) return label;
  return '<a href="' + escapeAttr(row.href) + '">' + label + '</a>';
}

function rowLabelMarkdown(row) {
  const label = escapeCell(row.label);
  if (!row.href) return label;
  return '[' + label + '](' + row.href + ')';
}

function cellFor(row, provider) {
  const cell = row.cells ? row.cells[provider.key] : null;
  if (!cell) {
    throw new Error('Row "' + (row.label || row.labelHtml) + '" has no availability for provider ' + provider.key);
  }
  return cell;
}

function renderMatrixTable(matrix, providers, strings) {
  if (!matrix.rows || matrix.rows.length === 0) {
    throw new Error('Matrix ' + matrix.key + ' has no rows');
  }
  const headers = [matrix.rowHeader];
  for (let index = 0; index < providers.length; index += 1) headers.push(providers[index].name);
  let allPlain = true;
  for (let rowIndex = 0; rowIndex < matrix.rows.length; rowIndex += 1) {
    const row = matrix.rows[rowIndex];
    if (row.labelHtml) allPlain = false;
    for (let providerIndex = 0; providerIndex < providers.length; providerIndex += 1) {
      if (!isPlainAvailability(cellFor(row, providers[providerIndex]))) allPlain = false;
    }
  }
  if (allPlain) {
    return gfmTable(headers, matrix.rows.map(function (row) {
      const cells = [rowLabelMarkdown(row)];
      for (let providerIndex = 0; providerIndex < providers.length; providerIndex += 1) {
        cells.push(availabilityText(cellFor(row, providers[providerIndex]), strings));
      }
      return cells;
    }));
  }
  return htmlTable(headers, matrix.rows.map(function (row) {
    const cells = [{html: p(rowLabelHtml(row))}];
    for (let providerIndex = 0; providerIndex < providers.length; providerIndex += 1) {
      cells.push({html: availabilityHtml(cellFor(row, providers[providerIndex]), strings)});
    }
    return cells;
  }));
}

function renderIpTable(rows, strings) {
  if (!rows || rows.length === 0) throw new Error('IP table has no rows');
  return gfmTable(strings.ipColumns, rows.map(function (row) {
    const cidrs = [];
    for (let index = 0; index < row.cidrs.length; index += 1) {
      cidrs.push('`' + row.cidrs[index] + '`');
    }
    return [escapeCell(row.region), escapeCell(row.location), cidrs.join(', ')];
  }));
}

// One fragment per cloud-data marker:
//   <CloudRegions provider="aws" />            -> section=regions  provider=aws
//   <CloudFeatures matrix="compute-types" />   -> section=compute-types
//   <RegionIps scope="service" />              -> section=service-ips
//   <RegionIps provider="aws" />               -> section=region-ips provider=aws
function renderFragment(model, request) {
  const strings = stringsFor(model.locale);
  const providers = model.providers;
  const findProvider = function () {
    for (let index = 0; index < providers.length; index += 1) {
      if (providers[index].key === request.provider) return providers[index];
    }
    throw new Error('Unknown provider "' + request.provider + '" for section ' + request.section);
  };
  switch (request.section) {
    case 'regions':
      return renderRegionsTable(findProvider(), strings);
    case 'compute-types':
    case 'deployment-options':
    case 'features': {
      const matrix = model.matrices ? model.matrices[request.section] : null;
      if (!matrix) throw new Error('Model has no matrix ' + request.section);
      return renderMatrixTable(matrix, providers, strings);
    }
    case 'service-ips':
      return renderIpTable(model.serviceIps, strings);
    case 'region-ips':
      return renderIpTable(findProvider().ipRows, strings);
    default:
      throw new Error('Unknown section: ' + request.section);
  }
}

// njs only supports default imports (see vocab.js).
export default {escapeText, renderFragment, renderRegionsTable, renderMatrixTable, renderIpTable};

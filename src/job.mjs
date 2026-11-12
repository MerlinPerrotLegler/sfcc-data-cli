import { DEFAULT_EXPORT } from './sfcc.mjs';

export const EXPORT_JOB_ID = 'sfcc-data-site-export';

function xml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function exportFilePrefix(instance) {
  const pattern = instance['download-file-pattern'];
  if (!pattern) return 'sfcc-data-export';
  return String(pattern).replace(/\.zip$/i, '').replace(/\*+$/, '').replace(/-+$/, '');
}

export function exportUnits(instance) {
  const units = structuredClone(DEFAULT_EXPORT);
  const pattern = String(instance['download-file-pattern'] || '');
  if (pattern.includes('no-static')) {
    delete units.global_data.static_resources;
    delete units.catalog_static_resources;
    delete units.library_static_resources;
  }
  return units;
}

export function exportJobXml(instance) {
  const units = JSON.stringify(exportUnits(instance));
  const file = exportFilePrefix(instance);
  return `<?xml version="1.0" encoding="UTF-8"?>
<jobs xmlns="http://www.demandware.com/xml/impex/jobs/2015-07-01">
    <job job-id="${xml(EXPORT_JOB_ID)}">
        <description>Site export for sfcc-data. Run it, then sfcc-data download ${xml(instance.id)}.</description>
        <flow>
            <context site-id="Sites"/>
            <step step-id="export" type="SiteExport" enforce-restart="false">
                <description>Writes impex/src/instance/${xml(file)}.zip</description>
                <parameters>
                    <parameter name="ExportFile">${xml(file)}</parameter>
                    <parameter name="OverwriteExportFile">true</parameter>
                    <parameter name="SaveOnRealm">false</parameter>
                    <parameter name="DataUnits">${xml(units)}</parameter>
                </parameters>
            </step>
        </flow>
        <triggers>
            <run-once enabled="false">
                <date>2020-01-01</date>
                <time>00:00:00.000Z</time>
            </run-once>
        </triggers>
    </job>
</jobs>
`;
}

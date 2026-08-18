export type PluginField = {
	key: string;
	label: string;
	type: 'text' | 'number' | 'boolean' | 'select' | 'list';
	help?: string;
	min?: number;
	max?: number;
	options?: string[];
};

export type PluginCatalogEntry = {
	key: string;
	label: string;
	description: string;
	city: string;
	defaultEndpoint: string;
	defaultConfig: Record<string, unknown>;
	fields: PluginField[];
};

const eventFields: PluginField[] = [
	{ key: 'title', label: 'Headline', type: 'text' },
	{ key: 'maxEvents', label: 'Number of events', type: 'number', min: 1, max: 4 },
	{ key: 'daysAhead', label: 'Look ahead (days)', type: 'number', min: 0, max: 30 },
	{ key: 'showVenue', label: 'Show venue', type: 'boolean' },
	{
		key: 'accent',
		label: 'Accent colour',
		type: 'select',
		options: ['red', 'blue', 'green', 'orange']
	}
];

export const pluginCatalog: PluginCatalogEntry[] = [
	{
		key: 'mannheim-events',
		label: 'Mannheim events',
		description: 'Concerts, markets and short events from the official city calendar.',
		city: 'Mannheim',
		defaultEndpoint: '/plugin-inputs/mannheim-events.json',
		defaultConfig: {
			title: 'MANNHEIM EVENTS',
			maxEvents: 4,
			daysAhead: 14,
			maxDurationDays: 2,
			showVenue: true,
			accent: 'blue'
		},
		fields: [
			...eventFields,
			{
				key: 'maxDurationDays',
				label: 'Maximum duration (days)',
				type: 'number',
				min: 1,
				max: 30,
				help: 'Repeated listings beyond this limit are hidden.'
			}
		]
	},
	{
		key: 'berlin-events',
		label: 'Berlin events',
		description: 'Street festivals and public events from Berlin Open Data.',
		city: 'Berlin',
		defaultEndpoint:
			'https://www.berlin.de/sen/web/service/maerkte-feste/strassen-volksfeste/index.php/index/all.json?q=',
		defaultConfig: {
			title: 'BERLIN EVENTS',
			maxEvents: 4,
			daysAhead: 30,
			districts: [],
			includeBrandenburg: false,
			showAddress: true,
			accent: 'red'
		},
		fields: [
			{ key: 'title', label: 'Headline', type: 'text' },
			{ key: 'maxEvents', label: 'Number of events', type: 'number', min: 1, max: 4 },
			{ key: 'daysAhead', label: 'Look ahead (days)', type: 'number', min: 0, max: 366 },
			{
				key: 'districts',
				label: 'Districts',
				type: 'list',
				help: 'Comma-separated; empty shows all.'
			},
			{ key: 'includeBrandenburg', label: 'Include Brandenburg', type: 'boolean' },
			{ key: 'showAddress', label: 'Show address', type: 'boolean' },
			{
				key: 'accent',
				label: 'Accent colour',
				type: 'select',
				options: ['red', 'blue', 'green', 'orange']
			}
		]
	},
	{
		key: 'berlin-tram-disruptions',
		label: 'Berlin tram disruptions',
		description: 'Current BVG traffic notices affecting tram lines.',
		city: 'Berlin',
		defaultEndpoint: 'https://www.bvg.de/disruption-reports-service/disruptions/v1/de',
		defaultConfig: { title: 'BERLIN / TRAM-LAGE', maxDisruptions: 4, lines: [], showDates: true },
		fields: [
			{ key: 'title', label: 'Headline', type: 'text' },
			{ key: 'maxDisruptions', label: 'Number of notices', type: 'number', min: 1, max: 4 },
			{
				key: 'lines',
				label: 'Tram lines',
				type: 'list',
				help: 'For example M1, M8; empty shows all.'
			},
			{ key: 'showDates', label: 'Show dates', type: 'boolean' }
		]
	},
	{
		key: 'stuttgart-stadtbahn-disruptions',
		label: 'Stuttgart Stadtbahn disruptions',
		description: 'Current VVS notices affecting Stuttgart U-Bahn lines.',
		city: 'Stuttgart',
		defaultEndpoint:
			'https://app.vvs.de/vvs/XML_ADDINFO_REQUEST?outputFormat=rapidJSON&filterPublicationStatus=current&serverInfo=1',
		defaultConfig: {
			title: 'STUTTGART / STADTBAHN',
			maxDisruptions: 4,
			lines: [],
			daysAhead: 14,
			showDates: true
		},
		fields: [
			{ key: 'title', label: 'Headline', type: 'text' },
			{ key: 'maxDisruptions', label: 'Number of notices', type: 'number', min: 1, max: 4 },
			{
				key: 'lines',
				label: 'Stadtbahn lines',
				type: 'list',
				help: 'For example U4, U13; empty shows all.'
			},
			{ key: 'daysAhead', label: 'Look ahead (days)', type: 'number', min: 0, max: 90 },
			{ key: 'showDates', label: 'Show dates', type: 'boolean' }
		]
	}
];

export function getPluginCatalogEntry(key: string) {
	return pluginCatalog.find((plugin) => plugin.key === key) ?? null;
}

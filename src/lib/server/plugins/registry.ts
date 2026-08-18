import { berlinEventsPlugin } from './definitions/berlin-events';
import { berlinTramDisruptionsPlugin } from './definitions/berlin-tram-disruptions';
import { mannheimEventsPlugin } from './definitions/mannheim-events';
import { squarePlugin } from './definitions/square';
import { stuttgartStadtbahnDisruptionsPlugin } from './definitions/stuttgart-stadtbahn-disruptions';
import type { AnyContentPlugin } from './types';

const registeredPlugins = new Map<string, AnyContentPlugin>([
	[berlinEventsPlugin.key, berlinEventsPlugin],
	[berlinTramDisruptionsPlugin.key, berlinTramDisruptionsPlugin],
	[mannheimEventsPlugin.key, mannheimEventsPlugin],
	[stuttgartStadtbahnDisruptionsPlugin.key, stuttgartStadtbahnDisruptionsPlugin],
	[squarePlugin.key, squarePlugin]
]);

export function getContentPlugin(key: string): AnyContentPlugin | null {
	return registeredPlugins.get(key) ?? null;
}

export function listContentPlugins(): AnyContentPlugin[] {
	return Array.from(registeredPlugins.values());
}

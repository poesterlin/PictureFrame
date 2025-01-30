import { commands, sendMqtt } from "$lib/mqtt";
import type { Actions } from "./$types";
import type { ISettings } from "./settings";


export const prerender = false;

export const actions: Actions = {
    default: async ({ request }: { request: Request }) => {
        const form = await request.formData();
        const values = JSON.parse(form.get("json") as string) as ISettings;

        const settings: Record<string, number | boolean | string> = {};

        if (!values || typeof values != "object") {
            return;
        }

        if (values.deleteCurrent && typeof values.deleteCurrent === "boolean") {
            settings.deleteCurrent = values.deleteCurrent;
        }

        if (values.reboot && typeof values.reboot === "boolean") {
            settings.reboot = values.reboot;
        }

        if (values.refreshNow && typeof values.refreshNow === "boolean") {
            settings.refreshNow = values.refreshNow;
        }

        if (values.download && typeof values.download === "boolean") {
            settings.download = values.download;
        }

        if (values.refreshEvery && typeof values.refreshEvery === "number") {
            settings.refreshEvery = values.refreshEvery;
        }

        if (values.clearLog && typeof values.clearLog === "boolean") {
            settings.clearLog = values.clearLog;
        }

        console.log(values)
        await sendMqtt(commands.commands, JSON.stringify(values))
    }
};


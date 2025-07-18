import bind from "bind-decorator";
import stringify from "json-stable-stringify-without-jsonify";
import * as zhc from "zigbee-herdsman-converters";
import Device from "../model/device";
import type {Zigbee2MQTTAPI} from "../types/api";
import logger from "../util/logger";
import * as settings from "../util/settings";
import utils from "../util/utils";
import Extension from "./extension";

/**
 * This extension calls the zigbee-herdsman-converters definition configure() method
 */
export default class Configure extends Extension {
    private configuring = new Set();
    private attempts: {[s: string]: number} = {};
    private topic = `${settings.get().mqtt.base_topic}/bridge/request/device/configure`;

    @bind private async onReconfigure(data: eventdata.Reconfigure): Promise<void> {
        // Disabling reporting unbinds some cluster which could be bound by configure, re-setup.
        if (data.device.zh.meta?.configured !== undefined) {
            delete data.device.zh.meta.configured;
            data.device.zh.save();
        }

        await this.configure(data.device, "reporting_disabled");
    }

    @bind private async onMQTTMessage(data: eventdata.MQTTMessage): Promise<void> {
        if (data.topic === this.topic) {
            const message = utils.parseJSON(data.message, data.message) as Zigbee2MQTTAPI["bridge/request/device/configure"];
            const ID = typeof message === "object" ? message.id : message;
            let error: string | undefined;

            if (ID === undefined) {
                error = "Invalid payload";
            } else {
                const device = this.zigbee.resolveEntity(ID);

                if (!device || !(device instanceof Device)) {
                    error = `Device '${ID}' does not exist`;
                } else if (!device.definition || !device.definition.configure) {
                    error = `Device '${device.name}' cannot be configured`;
                } else {
                    try {
                        await this.configure(device, "mqtt_message", true, true);
                    } catch (e) {
                        error = `Failed to configure (${(e as Error).message})`;
                    }
                }
            }

            const response = utils.getResponse<"bridge/response/device/configure">(message, {id: ID}, error);

            await this.mqtt.publish("bridge/response/device/configure", stringify(response));
        }
    }

    override start(): Promise<void> {
        setImmediate(async () => {
            // Only configure routers on startup, end devices are likely sleeping and
            // will reconfigure once they send a message
            for (const device of this.zigbee.devicesIterator((d) => d.type === "Router")) {
                // Sleep 10 seconds between configuring on startup to not DDoS the coordinator when many devices have to be configured.
                await utils.sleep(10);
                await this.configure(device, "started");
            }
        });

        this.eventBus.onDeviceJoined(this, async (data) => {
            if (data.device.zh.meta.configured !== undefined) {
                delete data.device.zh.meta.configured;
                data.device.zh.save();
            }

            await this.configure(data.device, "zigbee_event");
        });
        this.eventBus.onDeviceInterview(this, (data) => this.configure(data.device, "zigbee_event"));
        this.eventBus.onLastSeenChanged(this, (data) => this.configure(data.device, "zigbee_event"));
        this.eventBus.onMQTTMessage(this, this.onMQTTMessage);
        this.eventBus.onReconfigure(this, this.onReconfigure);

        return Promise.resolve();
    }

    private async configure(
        device: Device,
        event: "started" | "zigbee_event" | "reporting_disabled" | "mqtt_message",
        force = false,
        throwError = false,
    ): Promise<void> {
        if (!device.definition?.configure) {
            return;
        }

        if (!force) {
            if (device.options.disabled || !device.interviewed) {
                return;
            }

            if (device.zh.meta?.configured !== undefined) {
                return;
            }

            // Only configure end devices when it is active, otherwise it will likely fails as they are sleeping.
            if (device.zh.type === "EndDevice" && event !== "zigbee_event") {
                return;
            }
        }

        if (this.configuring.has(device.ieeeAddr) || (this.attempts[device.ieeeAddr] >= 3 && !force)) {
            return;
        }

        this.configuring.add(device.ieeeAddr);

        if (this.attempts[device.ieeeAddr] === undefined) {
            this.attempts[device.ieeeAddr] = 0;
        }

        logger.info(`Configuring '${device.name}'`);
        try {
            await device.definition.configure(device.zh, this.zigbee.firstCoordinatorEndpoint(), device.definition);
            logger.info(`Successfully configured '${device.name}'`);
            device.zh.meta.configured = zhc.getConfigureKey(device.definition);
            device.zh.save();
            this.eventBus.emitDevicesChanged();
        } catch (error) {
            this.attempts[device.ieeeAddr]++;
            const attempt = this.attempts[device.ieeeAddr];
            const msg = `Failed to configure '${device.name}', attempt ${attempt} (${(error as Error).stack})`;
            logger.error(msg);

            if (throwError) {
                throw error;
            }
        } finally {
            this.configuring.delete(device.ieeeAddr);
        }
    }
}

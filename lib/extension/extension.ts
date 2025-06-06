abstract class Extension {
    protected zigbee: Zigbee;
    protected mqtt: Mqtt;
    protected state: State;
    protected publishEntityState: PublishEntityState;
    protected eventBus: EventBus;
    protected enableDisableExtension: (enable: boolean, name: string) => Promise<void>;
    protected restartCallback: () => Promise<void>;
    protected addExtension: (extension: Extension) => Promise<void>;

    /**
     * Besides initializing variables, the constructor should do nothing!
     *
     * @param {Zigbee} zigbee Zigbee controller
     * @param {Mqtt} mqtt MQTT controller
     * @param {State} state State controller
     * @param {Function} publishEntityState Method to publish device state to MQTT.
     * @param {EventBus} eventBus The event bus
     * @param {enableDisableExtension} enableDisableExtension Enable/disable extension method
     * @param {restartCallback} restartCallback Restart Zigbee2MQTT
     * @param {addExtension} addExtension Add an extension
     */
    constructor(
        zigbee: Zigbee,
        mqtt: Mqtt,
        state: State,
        publishEntityState: PublishEntityState,
        eventBus: EventBus,
        enableDisableExtension: (enable: boolean, name: string) => Promise<void>,
        restartCallback: () => Promise<void>,
        addExtension: (extension: Extension) => Promise<void>,
    ) {
        this.zigbee = zigbee;
        this.mqtt = mqtt;
        this.state = state;
        this.publishEntityState = publishEntityState;
        this.eventBus = eventBus;
        this.enableDisableExtension = enableDisableExtension;
        this.restartCallback = restartCallback;
        this.addExtension = addExtension;
    }

    /**
     * Is called once the extension has to start
     */
    async start(): Promise<void> {}

    /**
     * Is called once the extension has to stop
     */

    // biome-ignore lint/suspicious/useAwait: API
    async stop(): Promise<void> {
        this.eventBus.removeListeners(this);
    }

    public adjustMessageBeforePublish(_entity: Group | Device, _message: KeyValue): void {}
}

export default Extension;

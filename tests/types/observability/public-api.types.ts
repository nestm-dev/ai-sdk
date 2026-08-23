import type { DynamicModule } from "@nestjs/common";
import {
	AiSdkObservabilityModule,
	AiSdkObservabilityService,
	AiSdkObservabilityTelemetryModule,
	AiSdkObservabilityTelemetryService,
	defineAiSdkObservabilityConfig,
	InMemoryAiObservabilityCollector,
	initializeAiSdkTelemetry,
	type AiObservabilityEvent,
	type AiSdkObservabilityOptionsFactory,
	type AiSdkObservabilityTelemetryRegistrationState,
	type AiObservabilitySnapshotV1,
} from "../../../src/observability/index.ts";
import { AiSdkObservabilityHttpModule } from "../../../src/observability/http/index.ts";
import {
	AiSdkObservabilityTestingModule,
	createFakeAiObservabilityClock,
	FakeAiObservabilityClock,
} from "../../../src/observability/testing/index.ts";

const clock = createFakeAiObservabilityClock(1_700_000_000_000);
const config = defineAiSdkObservabilityConfig({
	clock: clock.now,
	maxOperationGroups: 25,
	isGlobal: false,
});

const syncModule: DynamicModule = AiSdkObservabilityModule.forRoot(config);
const asyncModule: DynamicModule = AiSdkObservabilityModule.forRootAsync({
	isGlobal: false,
	useFactory: () => ({ clock: clock.now, maxToolGroups: 10 }),
});
const localHttpModule: DynamicModule = AiSdkObservabilityHttpModule.register({
	imports: [syncModule],
});
const testingModule: DynamicModule = AiSdkObservabilityTestingModule.forRoot({
	clock,
	maxModelGroups: 10,
});
const collector = new InMemoryAiObservabilityCollector({ clock: clock.now });
const event = {
	schemaVersion: 1,
	eventId: "operation:1:start",
	entityId: "operation:1",
	operationId: "operation:1",
	source: "type-test",
	timestamp: clock.currentTimeMs,
	type: "operation.started",
	operation: "generate-text",
} satisfies AiObservabilityEvent;
collector.record([event]);
type UnionKeys<VALUE> = VALUE extends unknown ? keyof VALUE : never;
type SensitiveTelemetryKey =
	| "prompt"
	| "prompts"
	| "output"
	| "outputs"
	| "reasoning"
	| "headers"
	| "providerMetadata"
	| "rawError"
	| "rawErrors"
	| "userId"
	| "tenantId";
const sensitiveEventFieldsAreAbsent: Record<
	Extract<UnionKeys<AiObservabilityEvent>, SensitiveTelemetryKey>,
	never
> = {};
const snapshot: AiObservabilitySnapshotV1 = collector.snapshot();
const serviceType: typeof AiSdkObservabilityService = AiSdkObservabilityService;
const httpModuleType: typeof AiSdkObservabilityHttpModule = AiSdkObservabilityHttpModule;
const aiSdkModuleType: typeof AiSdkObservabilityTelemetryModule = AiSdkObservabilityTelemetryModule;
const aiSdkServiceType: typeof AiSdkObservabilityTelemetryService =
	AiSdkObservabilityTelemetryService;
const initializeAiSdkTelemetryType: typeof initializeAiSdkTelemetry = initializeAiSdkTelemetry;
const registrationState: AiSdkObservabilityTelemetryRegistrationState = "provisional";
const fakeClockType: typeof FakeAiObservabilityClock = FakeAiObservabilityClock;

class OptionsFactory implements AiSdkObservabilityOptionsFactory {
	createAiSdkObservabilityOptions() {
		return { clock: clock.now };
	}
}

const optionsFactory: AiSdkObservabilityOptionsFactory = new OptionsFactory();

void syncModule;
void asyncModule;
void localHttpModule;
void testingModule;
void snapshot;
void serviceType;
void httpModuleType;
void aiSdkModuleType;
void aiSdkServiceType;
void initializeAiSdkTelemetryType;
void registrationState;
void fakeClockType;
void optionsFactory;
void sensitiveEventFieldsAreAbsent;

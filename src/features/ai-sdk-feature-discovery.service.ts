import { Injectable, OnApplicationBootstrap } from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core";
import { AiSdkConfigurationError } from "../ai-sdk.error.ts";
import type { AiSdkFeatureKind } from "../ai-sdk.tokens.ts";

const AI_SDK_FEATURE_MARKER = Symbol("@nestm/ai-sdk:feature-marker");

interface AiSdkFeatureMarker {
	readonly [AI_SDK_FEATURE_MARKER]: true;
	readonly kind: AiSdkFeatureKind;
	readonly name: string;
}

export function createAiSdkFeatureMarker(kind: AiSdkFeatureKind, name: string): AiSdkFeatureMarker {
	return { [AI_SDK_FEATURE_MARKER]: true, kind, name };
}

function isAiSdkFeatureMarker(value: unknown): value is AiSdkFeatureMarker {
	return (
		typeof value === "object" &&
		value !== null &&
		AI_SDK_FEATURE_MARKER in value &&
		(value as Partial<AiSdkFeatureMarker>)[AI_SDK_FEATURE_MARKER] === true
	);
}

@Injectable()
export class AiSdkFeatureDiscoveryService implements OnApplicationBootstrap {
	constructor(private readonly discovery: DiscoveryService) {}

	onApplicationBootstrap(): void {
		const seen = new Set<string>();
		for (const wrapper of this.discovery.getProviders()) {
			const instance: unknown = wrapper.instance;
			if (!isAiSdkFeatureMarker(instance)) continue;
			const identity = `${instance.kind}:${instance.name}`;
			if (seen.has(identity)) {
				throw new AiSdkConfigurationError(
					"DUPLICATE_FEATURE",
					`Duplicate AI SDK ${instance.kind} name "${instance.name}".`,
				);
			}
			seen.add(identity);
		}
	}
}

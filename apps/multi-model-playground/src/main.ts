import "reflect-metadata";

import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { initializeAiSdkTelemetry } from "@nestm/ai-sdk/observability";

import { AppModule } from "./app.module.ts";
import { PlaygroundConfigService } from "./config/playground-config.service.ts";
import { SafeExceptionFilter } from "./http/safe-exception.filter.ts";

const logger = new Logger("MultiModelPlayground");

async function bootstrap(): Promise<void> {
	const app = await NestFactory.create<NestFastifyApplication>(
		AppModule,
		new FastifyAdapter({ logger: false }),
		{ bufferLogs: true },
	);
	const config = app.get(PlaygroundConfigService);

	app.enableCors({
		origin: config.dashboardOrigin,
		methods: ["GET", "POST", "PATCH", "DELETE"],
		exposedHeaders: ["x-chat-run-id"],
	});
	app.enableShutdownHooks();
	app.useGlobalFilters(new SafeExceptionFilter());
	app.useGlobalPipes(
		new ValidationPipe({
			transform: true,
			whitelist: true,
			forbidNonWhitelisted: true,
		}),
	);

	await initializeAiSdkTelemetry(app);
	await app.listen(config.port, "127.0.0.1");
	logger.log(`Local playground listening on http://127.0.0.1:${String(config.port)}`);
}

void bootstrap().catch(() => {
	logger.error("The local playground failed to start. Check the validated environment.");
	process.exitCode = 1;
});

import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import type { Environment } from "./environment.js";

async function bootstrap(): Promise<void> {
	const app = await NestFactory.create(AppModule);
	const config = app.get(ConfigService<Environment, true>);
	const port = config.get("PORT", { infer: true });

	await app.listen(port);
}

void bootstrap();

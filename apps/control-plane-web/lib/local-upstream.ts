const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function localUpstreamEndpoint(baseUrl: string, path: string): URL {
	const endpoint = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
	if (
		(endpoint.protocol !== "http:" && endpoint.protocol !== "https:") ||
		endpoint.username !== "" ||
		endpoint.password !== "" ||
		!LOOPBACK_HOSTS.has(endpoint.hostname)
	) {
		throw new TypeError("The dashboard upstream must be loopback-only.");
	}
	return endpoint;
}

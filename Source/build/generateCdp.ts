/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import got from "got";

import { autoGeneratedFileHeader, writeCodeToFile } from "./generateUtils";
import jsDebugCustom from "./jsDebugCustom";
import nodeCustom from "./nodeCustom";
import wasmCustom from "./wasmCustom";

// generic hack -- I would prefer to union/omit, ProtocolType loses the ability
// to discriminate union types when passing through in that way.
interface IProtocolType<WithId> {
	name: WithId extends true ? never : string;
	id: WithId extends false ? never : string;
	description?: string;
	optional?: true;
	deprecated?: true;
	experimental?: true;
}

interface IProtocolRef<WithId> extends IProtocolType<WithId> {
	type: "";
	$ref: string;
}

interface IProtocolObject<WithId> extends IProtocolType<WithId> {
	type: "object";
	properties: ReadonlyArray<ProtocolType<false>>;
}

interface IProtocolString<WithId> extends IProtocolType<WithId> {
	type: "string";
	enum?: ReadonlyArray<string>;
}

interface IProtocolArray<WithId> extends IProtocolType<WithId> {
	type: "array";
	items: ProtocolType<false>;
}

type ProtocolType<WithId> =
	| IProtocolRef<WithId>
	| IProtocolObject<WithId>
	| IProtocolString<WithId>
	| IProtocolArray<WithId>;

interface IProtocolCommand {
	name: string;
	description: string;
	experimental?: true;
	deprecated?: true;
	parameters?: ReadonlyArray<ProtocolType<false>>;
	returns?: ReadonlyArray<ProtocolType<false>>;
}

interface IProtocolEvent {
	name: string;
	description: string;
	parameters?: ReadonlyArray<ProtocolType<false>>;
	deprecated?: true;
	experimental?: true;
}

interface IProtocolDomain {
	domain: string;
	experimental: boolean;
	dependencies?: ReadonlyArray<string>;
	types?: ReadonlyArray<ProtocolType<true>>;
	commands: ReadonlyArray<IProtocolCommand>;
	events: ReadonlyArray<IProtocolEvent>;
}

interface IProtocolDefinition {
	domains: ReadonlyArray<IProtocolDomain>;
	version: { major: string; minor: string };
}

function toTitleCase(s: string) {
	return s[0].toUpperCase() + s.substr(1);
}

const getDefinition = async (url: string) => {
	const { body } = await got<IProtocolDefinition>(url, {
		responseType: "json",
	});
	return body;
};

async function generate() {
	const jsProtocol = await getDefinition(
		"https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/js_protocol.json",
	);
	const browserProtocol = await getDefinition(
		"https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/browser_protocol.json",
	);

	const compareDomains = (a: IProtocolDomain, b: IProtocolDomain) =>
		a.domain.toUpperCase() < b.domain.toUpperCase() ? -1 : 1;
	const domains = jsProtocol.domains
		.concat(browserProtocol.domains)
		.concat(nodeCustom.domains as unknown as IProtocolDomain[])
		.concat(jsDebugCustom.domains as unknown as IProtocolDomain[])
		.concat(wasmCustom.domains as unknown as IProtocolDomain[])
		.sort(compareDomains);
	const result = [];
	const interfaceSeparator = createSeparator();

	result.push(autoGeneratedFileHeader("generateCdp.js"));
	result.push(`import { IDisposable } from '../common/disposable'; `);
	result.push(``);
	result.push(`export namespace Cdp {`);
	result.push(`export type integer = number;`);
	interfaceSeparator();

	function appendText(
		text: string,
		tags: { [key: string]: string | boolean } = {},
	) {
		for (const key of Object.keys(tags)) {
			const value = tags[key];
			if (!value) {
				continue;
			}

			text += `\n@${key}`;
			if (typeof value === "string") {
				text += ` ${value}`;
			}
		}

		if (!text) return;
		result.push("/**");
		for (const line of text.split("\n")) result.push(` * ${line}`);
		result.push(" */");
	}

	function createSeparator() {
		let first = true;
		return function () {
			if (!first) result.push("");
			first = false;
		};
	}

	function generateType(prop: ProtocolType<boolean>): string {
		if (prop.type === "string" && prop.enum) {
			return `${prop.enum.map((value) => `'${value}'`).join(" | ")}`;
		}
		if ("$ref" in prop) {
			return prop.$ref;
		}
		if (prop.type === "array") {
			const subtype = prop.items ? generateType(prop.items) : "any";
			return `${subtype}[]`;
		}
		if (prop.type === "object") {
			return "any";
		}
		return prop.type;
	}

	function appendProps(props: Iterable<ProtocolType<false>>) {
		const separator = createSeparator();
		for (const prop of props) {
			separator();
			appendText(prop.description ?? "", {
				deprecated: !!prop.deprecated,
			});
			result.push(
				`${prop.name}${prop.optional ? "?" : ""}: ${generateType(prop)};`,
			);
		}
	}

	function appendDomain(domain: IProtocolDomain) {
		const apiSeparator = createSeparator();
		const commands = domain.commands || [];
		const events = domain.events || [];
		const types = domain.types || [];
		const name = toTitleCase(domain.domain);
		interfaceSeparator();
		appendText(`Methods and events of the '${name}' domain.`);
		result.push(`export interface ${name}Api {`);
		for (const command of commands) {
			apiSeparator();
			appendText(command.description, {
				deprecated: !!command.deprecated,
			});
			result.push(
				`${command.name}(params: ${name}.${toTitleCase(
					command.name,
				)}Params): Promise<${name}.${toTitleCase(command.name)}Result | undefined>;`,
			);
		}
		for (const event of events) {
			apiSeparator();
			appendText(event.description, { deprecated: !!event.deprecated });
			result.push(
				`on(event: '${event.name}', listener: (event: ${name}.${toTitleCase(
					event.name,
				)}Event) => void): IDisposable;`,
			);
		}
		result.push(`}`);

		const typesSeparator = createSeparator();
		interfaceSeparator();
		appendText(`Types of the '${name}' domain.`);
		result.push(`export namespace ${name} {`);
		for (const command of commands) {
			typesSeparator();
			appendText(`Parameters of the '${name}.${command.name}' method.`);
			result.push(
				`export interface ${toTitleCase(command.name)}Params {`,
			);
			appendProps(command.parameters || []);
			result.push(`}`);
			typesSeparator();
			appendText(`Return value of the '${name}.${command.name}' method.`);
			result.push(
				`export interface ${toTitleCase(command.name)}Result {`,
			);
			appendProps(command.returns || []);
			result.push(`}`);
		}
		for (const event of events) {
			typesSeparator();
			appendText(`Parameters of the '${name}.${event.name}' event.`);
			result.push(`export interface ${toTitleCase(event.name)}Event {`);
			appendProps(event.parameters || []);
			result.push(`}`);
		}
		for (const type of types) {
			typesSeparator();
			appendText(type.description ?? "", {
				deprecated: !!type.deprecated,
			});
			if (type.type === "object") {
				result.push(`export interface ${toTitleCase(type.id)} {`);
				if (type.properties) appendProps(type.properties);
				else result.push(`[key: string]: any;`);
				result.push(`}`);
			} else {
				result.push(
					`export type ${toTitleCase(type.id)} = ${generateType(type)};`,
				);
			}
		}
		result.push(`}`);
	}

	function appendPauseResume() {
		result.push(`/**`);
		result.push(` * Pauses events being sent through the Api.`);
		result.push(` */`);
		result.push(`pause(): void;`);
		result.push(`/**`);
		result.push(` * Resumes previously-paused events`);
		result.push(` */`);
		result.push(`resume(): void;`);
	}

	interfaceSeparator();
	appendText("Protocol API.");
	result.push(`export interface Api {
    readonly session: import('./connection').CDPSession;
  `);
	appendPauseResume();
	domains.forEach((d) => {
		result.push(`${d.domain}: ${d.domain}Api;`);
	});
	result.push(`}`);

	domains.forEach((d) => appendDomain(d));

	result.push(`}`);
	result.push(``);
	result.push(`export default Cdp;`);
	result.push(``);

	writeCodeToFile(result.join("\n"), "src/cdp/api.d.ts");

	function generateTelemetryClassifications(
		domains: ReadonlyArray<IProtocolDomain>,
	) {
		const propertiesClassifications = domains.map((domain) => {
			const eventLines = (domain.events || []).map((event) => {
				const qualifiedEventName =
					`${domain.domain}.${event.name}`.toLowerCase();
				return `"${qualifiedEventName}": { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth' },
        "!${qualifiedEventName}.errors": { classification: 'CallstackOrException'; purpose: 'PerformanceAndHealth' },`;
			});
			return `
        // Domain: ${domain.domain}
        ${eventLines.join("\n")}`;
		});

		const interfaceCode = `${autoGeneratedFileHeader("generateCdp.js")}
    interface ICDPOperationClassification {
      ${propertiesClassifications.join("\n")}
    }
    `;
		writeCodeToFile(interfaceCode, "src/cdp/telemetryClassification.d.ts");
	}

	generateTelemetryClassifications(domains);
}

generate().catch(console.error);

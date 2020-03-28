'use strict';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'yaml';
import * as vscode from 'vscode';

const SCHEMA = 'crankscenarioyml';
const DOC_SELECTOR: vscode.DocumentSelector = {scheme: 'file', language: 'yaml', pattern: '**/*.crank.yml'};
let registryCache: Record<string, any>[];
let crankTerminal: vscode.Terminal | undefined;

export async function activate(context: vscode.ExtensionContext) {
  // Register our Crank scenario yaml format (for *.crank.yml).
  await registerYamlSchema();

  // Register IntelliSense subsriptions.
  registerStepProvider(context);
  registerCogProvider(context);
  registerStepIdProvider(context);
  registerDataKeyProvider(context);
  registerTokenProvider(context);

  // Register commands.
  const runScenarioCommand = vscode.commands.registerCommand('crankScenarioLanguage.runScenario', async (file: vscode.Uri) => {
    // Create and/or retrieve the crank terminal.
    crankTerminal = crankTerminal || vscode.window.createTerminal('crank', );
    vscode.window.showInformationMessage(`Running Scenario: ${file.path}`);
    crankTerminal.show();
    crankTerminal.sendText('clear');
    crankTerminal.sendText(`crank run ${file.path}`);
  });
  context.subscriptions.push(runScenarioCommand);

  // Unset crank terminal if the user closes it so we can re-spawn one.
  vscode.window.onDidCloseTerminal((terminal) => {
    if (terminal.name === 'crank') {
      crankTerminal = undefined;
    }
  });
}

export async function registerYamlSchema() {
  const yamlPlugin = await activateYamlExtension();
  if (!yamlPlugin) {
    vscode.window.showWarningMessage('No yaml...');
    return;
  }

  yamlPlugin.registerContributor(SCHEMA, onRequestSchemaURI, onRequestSchemaContent);
}

function onRequestSchemaURI(resource: string): string | undefined {
  if (resource.endsWith('.crank.yml') || resource.endsWith('.crank.yaml')) {
    return `${SCHEMA}://schema/crank-scenario`;
  }
  return undefined;
}

function onRequestSchemaContent(schemaUri: string): string | undefined {
  const parsedUri = vscode.Uri.parse(schemaUri);
  if (parsedUri.scheme !== SCHEMA) {
    return undefined;
  }
  if (!parsedUri.path || !parsedUri.path.startsWith('/')) {
    return undefined;
  }

  return fs.readFileSync(
    path.join(__dirname, 'schema', 'scenario-schema.json'),
    {encoding: 'utf8'},
  );
}

function registerStepProvider(context: vscode.ExtensionContext) {
  const stepList = getStepList();
  const stepProvider = vscode.languages.registerCompletionItemProvider(
    DOC_SELECTOR,
    {
      provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
        // get all text until the `position` and check if it reads `step: `
        // and if so then complete with a list of potential, matching steps.
        let linePrefix = document.lineAt(position).text.substr(0, position.character);
        if (!linePrefix.includes('step: ')) {
          return undefined;
        }
  
        return stepList.map(expression => {
          return new vscode.CompletionItem(expression, vscode.CompletionItemKind.Method);
        });
      }
    },
    ' ',
  );

  context.subscriptions.push(stepProvider);
}

function registerCogProvider(context: vscode.ExtensionContext) {
  const cogRegistry = getCogRegistry();
  const cogProvider = vscode.languages.registerCompletionItemProvider(
    DOC_SELECTOR,
    {
      provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
        // get all text until the `position` and check if it reads `step: `
        // and if so then complete with a list of potential, matching steps.
        let linePrefix = document.lineAt(position).text.substr(0, position.character);
        if (!linePrefix.includes('cog: ')) {
          return undefined;
        }
  
        return cogRegistry.map(regEntry => {
          return new vscode.CompletionItem(regEntry.name, vscode.CompletionItemKind.Value);
        });
      }
    },
    ' ',
  );

  context.subscriptions.push(cogProvider);
}

function registerStepIdProvider(context: vscode.ExtensionContext) {
  const stepRegistry = getStepRegistry();
  const cogProvider = vscode.languages.registerCompletionItemProvider(
    DOC_SELECTOR,
    {
      provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
        // get all text until the `position` and check if it reads `step: `
        // and if so then complete with a list of potential, matching steps.
        let linePrefix = document.lineAt(position).text.substr(0, position.character);
        if (!linePrefix.includes('stepId: ')) {
          return undefined;
        }

        const correspondingCogName = getCogNameForGivenLine(document, position);
  
        return stepRegistry.filter(stepDef => {
          return correspondingCogName ? stepDef._cog === correspondingCogName : true;
        }).map(stepDef => {
          return new vscode.CompletionItem(stepDef.stepId, vscode.CompletionItemKind.Value);
        })
      }
    },
    ' ',
  );

  context.subscriptions.push(cogProvider);
}

function registerDataKeyProvider(context: vscode.ExtensionContext) {
  const dataProvider = vscode.languages.registerCompletionItemProvider(
    DOC_SELECTOR,
    {
      provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
        // Ignore insufficiently indented lines and those already containing colons.
        const currentIndent = document.lineAt(position).firstNonWhitespaceCharacterIndex;
        if (currentIndent <= 2 || document.lineAt(position).text.includes(':')) {
          return undefined;
        }

        // Need to determine if this line is nested under a data key.
        const rollsUpTo = getClosestLessIndentedLine(currentIndent, document, position.translate(-1));
        if (!rollsUpTo.text.includes('data:')) {
          return undefined;
        }

        // Need to determine what step this belongs to.
        const step = getStepForGivenLine(document, position);
        if (!step) {
          return undefined;
        }

        return step.expectedFieldsList.map((field: Record<string, any>) => {
          return new vscode.CompletionItem(field.key, vscode.CompletionItemKind.Value);
        });
      }
    },
    ' ',
  );

  context.subscriptions.push(dataProvider);
}

function registerTokenProvider(context: vscode.ExtensionContext) {
  const tokenProvider = vscode.languages.registerCompletionItemProvider(
    DOC_SELECTOR,
    {
      provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
        const tokens = getTokensAtLine(document, position);

        // @todo: Support nested token object tokens.
        return Object.keys(tokens).map((token: string) => {
          // Note: the first part of the token only includes a single bracket, since the
          // auto-complete is triggered by typing a single bracket to begin with.
          return new vscode.CompletionItem(`{${token}}`, vscode.CompletionItemKind.Value);
        });
      }
    },
    '{',
  );

  context.subscriptions.push(tokenProvider);
}

function getClosestLessIndentedLine(indent: number, document: vscode.TextDocument, position: vscode.Position): vscode.TextLine {
  const currentIndent = document.lineAt(position).firstNonWhitespaceCharacterIndex;

  // Base-case: This line's indent is less than one given, and non-zero.
  if (currentIndent !== 0 && currentIndent < indent) {
    return document.lineAt(position);
  }

  // Otherwise, recurse until we find that elusive line.
  return getClosestLessIndentedLine(indent, document, position.translate(-1));
}

function getTokensAtLine(document: vscode.TextDocument, position: vscode.Position): Record<string, any> {
  let tokens: Record<string, any> = {};

  // Pull out static tokens defined on the scenario.
  try {
    const yml = yaml.parse(document.getText());
    if (yml.tokens) {
      tokens = yml.tokens;
    }
  } catch (e) {}

  // Pull out dynamic tokens available as of the step on this line.
  try {
    getStepAndLineMetadata(document).filter(s => {
      return s.lineRange.end < position.line + 1;
    }).forEach(s => {
      if (!s.fromRegistry || !s.fromRegistry.expectedRecordsList) {
        return null;
      }

      const cogToken = s.fromRegistry._cog.split('/')[1];
      s.fromRegistry.expectedRecordsList.forEach((r: any) => {
        const tokenPrefix = `${cogToken}.${r.id}`;
        if (r.guaranteedFieldsList) {
          r.guaranteedFieldsList.forEach((f: any) => {
            // KeyValue Record
            if (r.type === 0) {
              tokens[`${tokenPrefix}.${f.key}`] = '';
            }
            // Table Record
            else if (r.type === 1) {
              tokens[`${tokenPrefix}.1.${f.key}`] = '';
            }
          });

          // Don't forget to handle when the dynamic tokens are also dynamic.
          if (r.mayHaveMoreFields) {
            tokens[`${tokenPrefix}${r.type === 1 ? '.1' : ''}.*`.toLowerCase()] = '';
          }
        }
      });
    });

  } catch (e) {}

  return tokens;
}

function getStepAndLineMetadata(document: vscode.TextDocument): any[] {
  const stepRegistry = getStepRegistry();
  const cstDoc = yaml.parseCST(document.getText());

  // Check for any items at all.
  const docContents: any = cstDoc[0]['contents'][0];
  if (!docContents || !docContents.items) {
    return [];
  }
  const docItems = docContents.items;

  // Check for a "steps" key.
  const stepsPlainValueIndex = docItems.findIndex((i: any) => i.type && i.type === 'PLAIN' && i.strValue && i.strValue === 'steps');
  if (stepsPlainValueIndex === -1 ) {
    return [];
  }

  // Check for corresponding steps.
  const docSteps = docItems[stepsPlainValueIndex + 1];
  if (!docSteps || !docSteps.node || docSteps.node.type !== 'SEQ') {
    return [];
  }

  // Iterate through each step, pull the corresponding step definition.
  // And note its line number / context.
  return docSteps.node.items.map((i: any) => {
    const asObject = yaml.parse(i.rawValue)[0];
    return {
      lineRange: {
        start: i.rangeAsLinePos.start.line,
        end: i.rangeAsLinePos.end.line - 1,
      },
      asObject: asObject,
      fromRegistry: ((obj) => {
        // Match step expressions to steps.
        if (obj.step) {
          return stepRegistry.find(step => {
            return obj.step.match(new RegExp(step.expression, 'i')) || obj.step === step.expression;
          });
        }
        // Otherwise, if a specific step/cog was provided. Sweet.
        if (obj.cog && obj.stepId) {
          return stepRegistry.find(step => {
            return step._cog === obj.cog && step.stepId === obj.stepId;
          });
        }
      })(asObject),
    }
  });
}

function getCogNameForGivenLine(document: vscode.TextDocument, position: vscode.Position): string | undefined {
  const steps = getStepAndLineMetadata(document);
  const step = steps.find(s => s.lineRange.start <= position.line + 1 && s.lineRange.end >= position.line + 1);
  return step && step.fromRegistry ? step.fromRegistry._cog : step.asObject.cog;
}

function getStepForGivenLine(document: vscode.TextDocument, position: vscode.Position): Record<string, any> | undefined {
  const steps = getStepAndLineMetadata(document);
  const step = steps.find(s => s.lineRange.start <= position.line + 1 && s.lineRange.end >= position.line + 1);
  return step ? step.fromRegistry : undefined;
}

////////

function getCrankCacheDirectory(): string {
  const platform = os.platform();
  const home = getHomeDir()

  // MacOS has a specific directory.
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Caches', 'crank');
  }

  // Windows logic is as follows.
  if (platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || '', 'crank');
  }

  // Other *nix systems.
  return path.join(home, '.cache', 'crank');
}

/**
 * Copies the logic from oclif for retrieving the home directory.
 */
function getHomeDir(): string {
  return process.env.HOME ||
    (os.platform() === 'win32' && (() => {
      return (process.env.HOMEDRIVE && process.env.HOMEPATH && path.join(process.env.HOMEDRIVE!, process.env.HOMEPATH!)) ||
        process.env.USERPROFILE;
    })()) || os.homedir() || os.tmpdir();
}

function getCogRegistry(): Record<string, any>[] {
  if (registryCache) {
    return registryCache;
  }
  const registryFile = path.join(getCrankCacheDirectory(), 'cog-registry.json');
  registryCache = JSON.parse(fs.readFileSync(registryFile, {encoding: 'utf8'}));
  return registryCache;
}

function getStepRegistry(): Record<string, any>[] {
  const registry = getCogRegistry();
  const steps: Record<string, any>[] = [];

  registry.forEach(cogRegEntry => {
    cogRegEntry.stepDefinitionsList.forEach((stepDef: Record<string, any>) => {
      steps.push(Object.assign({_cog: cogRegEntry.name}, stepDef));
    });
  });

  return steps;
}

function getStepList(): string[] {
  const stepRegistry = getStepRegistry();
  const stepTexts: string[] = [];

  stepRegistry.forEach((stepDef: Record<string, any>) => {
    stepTexts.push(stepDef.expression);
  });

  return stepTexts;
}

const VSCODE_YAML_EXTENSION_ID = 'redhat.vscode-yaml';

export interface YamlExtension {
  registerContributor(
    schema: string,
    requestSchema: (resource: string) => string | undefined,
    requestSchemaContent: (uri: string) => string | undefined
  ): void;
}

export async function activateYamlExtension(): Promise<YamlExtension | undefined> {
  const extension = vscode.extensions.getExtension(VSCODE_YAML_EXTENSION_ID);
  if (!extension) {
    return undefined;
  }

  const extensionAPI = await extension.activate();
  if (!extensionAPI || !extensionAPI.registerContributor) {
    return undefined;
  }

  return extensionAPI;
}

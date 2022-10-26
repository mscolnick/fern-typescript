import { AbsoluteFilePath, RelativeFilePath } from "@fern-api/core-utils";
import { DeclaredErrorName } from "@fern-fern/ir-model/errors";
import { IntermediateRepresentation } from "@fern-fern/ir-model/ir";
import { DeclaredServiceName } from "@fern-fern/ir-model/services/commons";
import { HttpEndpoint } from "@fern-fern/ir-model/services/http";
import { DeclaredTypeName, ShapeType } from "@fern-fern/ir-model/types";
import { ErrorResolver, TypeResolver } from "@fern-typescript/resolvers";
import { GeneratorContext, SdkFile } from "@fern-typescript/sdk-declaration-handler";
import { ErrorDeclarationHandler } from "@fern-typescript/sdk-errors";
import { ServiceDeclarationHandler } from "@fern-typescript/sdk-service-declaration-handler";
import {
    TypeReferenceToParsedTypeNodeConverter,
    TypeReferenceToRawTypeNodeConverter,
    TypeReferenceToSchemaConverter,
    TypeReferenceToStringExpressionConverter,
} from "@fern-typescript/type-reference-converters";
import { EnumTypeGenerator, getSubImportPathToRawSchema, TypeDeclarationHandler } from "@fern-typescript/types-v2";
import { Volume } from "memfs/lib/volume";
import path from "path";
import { Directory, Project, SourceFile } from "ts-morph";
import { constructAugmentedServices } from "./constructAugmentedServices";
import { CoreUtilitiesManager } from "./core-utilities/CoreUtilitiesManager";
import { ImportStrategy } from "./declaration-referencers/DeclarationReferencer";
import { EndpointDeclarationReferencer } from "./declaration-referencers/EndpointDeclarationReferencer";
import { ErrorDeclarationReferencer } from "./declaration-referencers/ErrorDeclarationReferencer";
import { RootServiceDeclarationReferencer } from "./declaration-referencers/RootServiceDeclarationReferencer";
import { ServiceDeclarationReferencer } from "./declaration-referencers/ServiceDeclarationReferencer";
import { TypeDeclarationReferencer } from "./declaration-referencers/TypeDeclarationReferencer";
import { DependencyManager } from "./dependency-manager/DependencyManager";
import { EnvironmentsGenerator } from "./environments/EnvironmentsGenerator";
import {
    convertExportedFilePathToFilePath,
    ExportedDirectory,
    ExportedFilePath,
} from "./exports-manager/ExportedFilePath";
import { ExportsManager } from "./exports-manager/ExportsManager";
import { createExternalDependencies } from "./external-dependencies/createExternalDependencies";
import { generateTypeScriptProject } from "./generate-ts-project/generateTypeScriptProject";
import { ImportsManager } from "./imports-manager/ImportsManager";
import { parseAuthSchemes } from "./parseAuthSchemes";

const FILE_HEADER = `/**
 * This file auto-generated by Fern from our API Definition.
 */
`;

const SCHEMA_IMPORT_STRATEGY: ImportStrategy = { type: "fromRoot", namespaceImport: "serializers" };

export declare namespace SdkGenerator {
    export interface Init {
        apiName: string;
        intermediateRepresentation: IntermediateRepresentation;
        context: GeneratorContext;
        volume: Volume;
        packageName: string;
        packageVersion: string | undefined;
        repositoryUrl: string | undefined;
    }
}

export class SdkGenerator {
    private context: GeneratorContext;
    private intermediateRepresentation: IntermediateRepresentation;

    private rootDirectory: Directory;
    private exportsManager = new ExportsManager();
    private dependencyManager = new DependencyManager();
    private coreUtilitiesManager = new CoreUtilitiesManager();
    private typeResolver: TypeResolver;
    private errorResolver: ErrorResolver;

    private typeDeclarationReferencer: TypeDeclarationReferencer;
    private typeSchemaDeclarationReferencer: TypeDeclarationReferencer;
    private errorDeclarationReferencer: ErrorDeclarationReferencer;
    private errorSchemaDeclarationReferencer: ErrorDeclarationReferencer;
    private serviceDeclarationReferencer: ServiceDeclarationReferencer;
    private rootServiceDeclarationReferencer: RootServiceDeclarationReferencer;
    private endpointDeclarationReferencer: EndpointDeclarationReferencer;
    private endpointSchemaDeclarationReferencer: EndpointDeclarationReferencer;

    private environmentsGenerator: EnvironmentsGenerator;

    private generatePackage: () => Promise<void>;

    constructor({
        apiName,
        intermediateRepresentation,
        context,
        volume,
        packageName,
        packageVersion,
        repositoryUrl,
    }: SdkGenerator.Init) {
        this.context = context;
        this.intermediateRepresentation = intermediateRepresentation;

        const project = new Project({
            useInMemoryFileSystem: true,
        });
        this.rootDirectory = project.createDirectory("/");
        this.typeResolver = new TypeResolver(intermediateRepresentation);
        this.errorResolver = new ErrorResolver(intermediateRepresentation);

        const apiDirectory: ExportedDirectory[] = [
            {
                nameOnDisk: "resources",
                exportDeclaration: { exportAll: true },
            },
        ];

        const schemaDirectory: ExportedDirectory[] = [
            {
                nameOnDisk: "serialization",
            },
        ];

        this.typeDeclarationReferencer = new TypeDeclarationReferencer({
            containingDirectory: apiDirectory,
        });
        this.typeSchemaDeclarationReferencer = new TypeDeclarationReferencer({
            containingDirectory: schemaDirectory,
        });
        this.errorDeclarationReferencer = new ErrorDeclarationReferencer({
            containingDirectory: apiDirectory,
        });
        this.errorSchemaDeclarationReferencer = new ErrorDeclarationReferencer({
            containingDirectory: schemaDirectory,
        });
        this.serviceDeclarationReferencer = new ServiceDeclarationReferencer({
            containingDirectory: apiDirectory,
        });
        this.rootServiceDeclarationReferencer = new RootServiceDeclarationReferencer({
            containingDirectory: [],
            apiName,
        });
        this.endpointDeclarationReferencer = new EndpointDeclarationReferencer({
            containingDirectory: apiDirectory,
        });
        this.endpointSchemaDeclarationReferencer = new EndpointDeclarationReferencer({
            containingDirectory: schemaDirectory,
        });

        this.environmentsGenerator = new EnvironmentsGenerator({ intermediateRepresentation });

        this.generatePackage = async () => {
            await generateTypeScriptProject({
                volume,
                packageName,
                packageVersion,
                project,
                dependencies: this.dependencyManager.getDependencies(),
                repositoryUrl,
                rootService: {
                    name: this.rootServiceDeclarationReferencer.getExportedName(),
                    relativeFilepath: RelativeFilePath.of(
                        path.relative(
                            "/",
                            convertExportedFilePathToFilePath(
                                this.rootServiceDeclarationReferencer.getExportedFilepath()
                            )
                        )
                    ),
                },
            });
        };
    }

    public async generate(): Promise<void> {
        this.generateTypeDeclarations();
        this.generateErrorDeclarations();
        this.generateServiceDeclarations();
        this.generateEnvironments();
        this.coreUtilitiesManager.finalize(this.exportsManager, this.dependencyManager);
        this.exportsManager.writeExportsToProject(this.rootDirectory);
        await this.generatePackage();
    }

    public async copyCoreUtilities({ pathToPackage }: { pathToPackage: AbsoluteFilePath }): Promise<void> {
        await this.coreUtilitiesManager.copyCoreUtilities({ pathToPackage });
    }

    private generateTypeDeclarations() {
        for (const typeDeclaration of this.intermediateRepresentation.types) {
            this.withSdkFile({
                filepath: this.typeDeclarationReferencer.getExportedFilepath(typeDeclaration.name),
                run: (typeFile) => {
                    this.withSdkFile({
                        filepath: this.typeSchemaDeclarationReferencer.getExportedFilepath(typeDeclaration.name),
                        isGeneratingSchemaFile: true,
                        run: (schemaFile) => {
                            TypeDeclarationHandler(typeDeclaration, {
                                typeFile,
                                schemaFile,
                                typeName: this.typeDeclarationReferencer.getExportedName(typeDeclaration.name),
                                context: this.context,
                            });
                        },
                    });
                },
            });
        }
    }

    private generateErrorDeclarations() {
        for (const errorDeclaration of this.intermediateRepresentation.errors) {
            this.withSdkFile({
                filepath: this.errorDeclarationReferencer.getExportedFilepath(errorDeclaration.name),
                run: (errorFile) => {
                    this.withSdkFile({
                        filepath: this.errorSchemaDeclarationReferencer.getExportedFilepath(errorDeclaration.name),
                        isGeneratingSchemaFile: true,
                        run: (schemaFile) => {
                            ErrorDeclarationHandler(errorDeclaration, {
                                errorFile,
                                schemaFile,
                                errorName: this.errorDeclarationReferencer.getExportedName(errorDeclaration.name),
                                context: this.context,
                            });
                        },
                    });
                },
            });
        }
    }

    private generateServiceDeclarations() {
        const services = constructAugmentedServices(this.intermediateRepresentation);
        for (const service of services) {
            const declarationReferencer =
                service.name.fernFilepath.length > 0
                    ? this.serviceDeclarationReferencer
                    : this.rootServiceDeclarationReferencer;
            this.withSdkFile({
                filepath: declarationReferencer.getExportedFilepath(service.name),
                run: (serviceFile) => {
                    ServiceDeclarationHandler(service, {
                        serviceClassName: declarationReferencer.getExportedName(),
                        context: this.context,
                        serviceFile,
                        withEndpoint: this.createWithEndpoint(service.name),
                    });
                },
            });
        }
    }

    private generateEnvironments(): void {
        this.withSourceFile({
            filepath: this.environmentsGenerator.getFilepath(),
            run: ({ sourceFile }) => {
                this.environmentsGenerator.generateEnvironments(sourceFile);
            },
        });
    }

    private createWithEndpoint(
        serviceName: DeclaredServiceName
    ): (endpoint: HttpEndpoint, run: (args: ServiceDeclarationHandler.withEndpoint.Args) => void) => void {
        return (endpoint, run) => {
            const endpointName: EndpointDeclarationReferencer.Name = { serviceName, endpoint };
            this.withSdkFile({
                filepath: this.endpointDeclarationReferencer.getExportedFilepath(endpointName),
                run: (endpointFile) => {
                    this.withSdkFile({
                        filepath: this.endpointSchemaDeclarationReferencer.getExportedFilepath(endpointName),
                        isGeneratingSchemaFile: true,
                        run: (schemaFile) => {
                            run({ endpointFile, schemaFile });
                        },
                    });
                },
            });
        };
    }

    private withSdkFile({
        run,
        filepath,
        isGeneratingSchemaFile = false,
    }: {
        run: (file: SdkFile) => void;
        filepath: ExportedFilePath;
        // TODO switch to classes so we can override via subclass
        isGeneratingSchemaFile?: boolean;
    }) {
        this.withSourceFile({
            filepath,
            run: ({ sourceFile, importsManager }) => {
                const addImport = importsManager.addImport.bind(importsManager);

                const getReferenceToNamedType = (typeName: DeclaredTypeName) =>
                    this.typeDeclarationReferencer.getReferenceToType({
                        name: typeName,
                        importStrategy: { type: "fromRoot" },
                        referencedIn: sourceFile,
                        addImport,
                    });

                const typeReferenceToParsedTypeNodeConverter = new TypeReferenceToParsedTypeNodeConverter({
                    getReferenceToNamedType: (typeName) => getReferenceToNamedType(typeName).entityName,
                    resolveType: this.typeResolver.resolveTypeName.bind(this.typeResolver),
                    getReferenceToRawEnum: (referenceToEnum) =>
                        EnumTypeGenerator.getReferenceToRawValueType({ referenceToModule: referenceToEnum }),
                });

                const getReferenceToRawNamedType = (typeName: DeclaredTypeName) =>
                    this.typeSchemaDeclarationReferencer.getReferenceToType({
                        name: typeName,
                        importStrategy: SCHEMA_IMPORT_STRATEGY,
                        subImport: getSubImportPathToRawSchema(),
                        addImport,
                        referencedIn: sourceFile,
                    });

                const typeReferenceToRawTypeNodeConverter = new TypeReferenceToRawTypeNodeConverter({
                    getReferenceToNamedType: (typeName) => getReferenceToRawNamedType(typeName).entityName,
                    resolveType: this.typeResolver.resolveTypeName.bind(this.typeResolver),
                });

                const coreUtilities = this.coreUtilitiesManager.getCoreUtilities({ sourceFile, addImport });

                const getReferenceToNamedTypeSchema = (typeName: DeclaredTypeName) =>
                    this.typeSchemaDeclarationReferencer.getReferenceToType({
                        name: typeName,
                        importStrategy: SCHEMA_IMPORT_STRATEGY,
                        addImport,
                        referencedIn: sourceFile,
                    });

                const getSchemaOfNamedType = (typeName: DeclaredTypeName) => {
                    let schema = coreUtilities.zurg.Schema._fromExpression(
                        getReferenceToNamedTypeSchema(typeName).expression
                    );

                    // when generating schemas, wrapped named types with lazy() to prevent issues with circular imports
                    if (isGeneratingSchemaFile) {
                        const resolvedType = this.typeResolver.resolveTypeName(typeName);
                        schema =
                            resolvedType._type === "named" && resolvedType.shape === ShapeType.Object
                                ? coreUtilities.zurg.lazyObject(schema)
                                : coreUtilities.zurg.lazy(schema);
                    }

                    return schema;
                };

                const typeReferenceToSchemaConverter = new TypeReferenceToSchemaConverter({
                    getSchemaOfNamedType,
                    zurg: coreUtilities.zurg,
                    resolveType: this.typeResolver.resolveTypeName.bind(this.typeResolver),
                });

                const addDependency = (name: string, version: string, options?: { preferPeer?: boolean }) => {
                    this.dependencyManager.addDependency(name, version, options);
                };

                const externalDependencies = createExternalDependencies({
                    addDependency,
                    addImport,
                });

                const getErrorSchema = (errorName: DeclaredErrorName) => {
                    let schema = coreUtilities.zurg.Schema._fromExpression(
                        this.errorSchemaDeclarationReferencer.getReferenceToError({
                            name: errorName,
                            importStrategy: SCHEMA_IMPORT_STRATEGY,
                            addImport,
                            referencedIn: sourceFile,
                        }).expression
                    );

                    // when generating schemas, wrapped errors with lazy() to prevent issues with circular imports
                    if (isGeneratingSchemaFile) {
                        schema = coreUtilities.zurg.lazy(schema);
                    }

                    return schema;
                };

                const typeReferenceToStringExpressionConverter = new TypeReferenceToStringExpressionConverter({
                    resolveType: this.typeResolver.resolveTypeName.bind(this.typeResolver),
                    stringifyEnum: EnumTypeGenerator.getReferenceToRawValue.bind(this),
                });

                const file: SdkFile = {
                    sourceFile,
                    getReferenceToType: typeReferenceToParsedTypeNodeConverter.convert.bind(
                        typeReferenceToParsedTypeNodeConverter
                    ),
                    getReferenceToNamedType,
                    getReferenceToService: (serviceName, { importAlias }) =>
                        this.serviceDeclarationReferencer.getReferenceToClient({
                            name: serviceName,
                            referencedIn: sourceFile,
                            addImport,
                            importStrategy: { type: "direct", alias: importAlias },
                        }),
                    getReferenceToEndpointFileExport: (serviceName, endpoint, export_) =>
                        this.endpointDeclarationReferencer.getReferenceToEndpointExport({
                            name: { serviceName, endpoint },
                            referencedIn: sourceFile,
                            addImport,
                            importStrategy: { type: "fromRoot" },
                            subImport: typeof export_ === "string" ? [export_] : export_,
                        }),
                    getReferenceToEndpointSchemaFileExport: (serviceName, endpoint, export_) =>
                        this.endpointSchemaDeclarationReferencer.getReferenceToEndpointExport({
                            name: { serviceName, endpoint },
                            referencedIn: sourceFile,
                            addImport,
                            importStrategy: SCHEMA_IMPORT_STRATEGY,
                            subImport: typeof export_ === "string" ? [export_] : export_,
                        }),
                    resolveTypeReference: this.typeResolver.resolveTypeReference.bind(this.typeResolver),
                    getErrorDeclaration: (errorName) => this.errorResolver.getErrorDeclarationFromName(errorName),
                    getReferenceToError: (errorName) =>
                        this.errorDeclarationReferencer.getReferenceToError({
                            name: errorName,
                            importStrategy: { type: "fromRoot" },
                            referencedIn: sourceFile,
                            addImport,
                        }),
                    externalDependencies,
                    coreUtilities,
                    getSchemaOfNamedType,
                    getErrorSchema,
                    authSchemes: parseAuthSchemes({
                        apiAuth: this.intermediateRepresentation.auth,
                        coreUtilities,
                        getReferenceToType: (typeReference) =>
                            typeReferenceToParsedTypeNodeConverter.convert(typeReference).typeNode,
                    }),
                    fernConstants: this.intermediateRepresentation.constants,
                    getReferenceToRawType: typeReferenceToRawTypeNodeConverter.convert.bind(
                        typeReferenceToRawTypeNodeConverter
                    ),
                    getReferenceToRawNamedType,
                    getReferenceToRawError: (errorName) =>
                        this.errorSchemaDeclarationReferencer.getReferenceToError({
                            name: errorName,
                            importStrategy: SCHEMA_IMPORT_STRATEGY,
                            subImport: getSubImportPathToRawSchema(),
                            addImport,
                            referencedIn: sourceFile,
                        }),
                    getSchemaOfTypeReference:
                        typeReferenceToSchemaConverter.convert.bind(typeReferenceToSchemaConverter),
                    convertExpressionToString: (expression, typeReference) =>
                        typeReferenceToStringExpressionConverter.convert(typeReference)(expression),
                    environments: this.environmentsGenerator.toParsedEnvironments({
                        sourceFile,
                        addImport,
                    }),
                };

                run(file);
            },
        });
    }

    private withSourceFile({
        run,
        filepath,
    }: {
        run: (args: { sourceFile: SourceFile; importsManager: ImportsManager }) => void;
        filepath: ExportedFilePath;
    }) {
        const filepathStr = convertExportedFilePathToFilePath(filepath);
        this.context.logger.debug(`Generating ${filepathStr}`);

        const sourceFile = this.rootDirectory.createSourceFile(filepathStr);
        const importsManager = new ImportsManager();

        run({ sourceFile, importsManager });

        if (sourceFile.getStatements().length === 0) {
            sourceFile.delete();
            this.context.logger.debug(`Skipping ${filepathStr} (no content)`);
        } else {
            importsManager.writeImportsToSourceFile(sourceFile);
            this.exportsManager.addExportsForFilepath(filepath);

            // this needs to be last.
            // https://github.com/dsherret/ts-morph/issues/189#issuecomment-414174283
            sourceFile.insertText(0, (writer) => {
                writer.writeLine(FILE_HEADER);
            });

            this.context.logger.debug(`Generated ${filepathStr}`);
        }
    }
}

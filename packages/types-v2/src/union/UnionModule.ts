import { getTextOfTsNode } from "@fern-typescript/commons";
import { SdkFile } from "@fern-typescript/sdk-declaration-handler";
import { InterfaceDeclarationStructure, OptionalKind, ts } from "ts-morph";
import { AbstractUnionFileDeclaration } from "./AbstractUnionFileDeclaration";
import {
    AbstractParsedSingleUnionType,
    ParsedSingleUnionType,
} from "./parsed-single-union-type/AbstractParsedSingleUnionType";
import { UnionVisitHelper } from "./UnionVisitHelper";

export class UnionModule extends AbstractUnionFileDeclaration {
    public static readonly UTILS_INTERFACE_NAME = "_Utils";
    public static readonly VISIT_UTIL_PROPERTY_NAME = "_visit";
    public static readonly UNKNOWN_DISCRIMINANT_TYPE = ts.factory.createKeywordTypeNode(ts.SyntaxKind.VoidKeyword);
    public static readonly UNKNOWN_SINGLE_UNION_TYPE_INTERFACE_NAME = "_Unknown";

    public writeToFile(file: SdkFile, unionVisitHelper: UnionVisitHelper): void {
        const module = file.sourceFile.addModule({
            name: this.getModuleName(),
            isExported: true,
            hasDeclareKeyword: true,
        });
        module.addInterfaces(this.getSingleUnionTypeInterfaces(file));
        module.addInterface(this.getUtilsInterface());
        module.addInterface(unionVisitHelper.getVisitorInterface(file));
    }

    private getSingleUnionTypeInterfaces(file: SdkFile): OptionalKind<InterfaceDeclarationStructure>[] {
        const interfaces = [
            ...this.parsedSingleUnionTypes.map((singleUnionType) => singleUnionType.getInterfaceDeclaration(file)),
            AbstractParsedSingleUnionType.createDiscriminatedInterface({
                typeName: UnionModule.UNKNOWN_SINGLE_UNION_TYPE_INTERFACE_NAME,
                discriminantValue: UnionModule.UNKNOWN_DISCRIMINANT_TYPE,
                union: this.union,
                isRaw: false,
            }),
        ];

        for (const interface_ of interfaces) {
            interface_.extends.push(ts.factory.createTypeReferenceNode(UnionModule.UTILS_INTERFACE_NAME));
        }

        return interfaces.map((interface_) => ({
            name: interface_.name,
            extends: interface_.extends.map(getTextOfTsNode),
            properties: interface_.jsonProperties,
        }));
    }

    private getUtilsInterface(): OptionalKind<InterfaceDeclarationStructure> {
        return {
            name: UnionModule.UTILS_INTERFACE_NAME,
            properties: [
                {
                    name: UnionModule.VISIT_UTIL_PROPERTY_NAME,
                    type: getTextOfTsNode(
                        UnionVisitHelper.getSignature({
                            getReferenceToVisitor: this.getReferenceToVisitorInterface.bind(this),
                        })
                    ),
                },
            ],
        };
    }

    private getModuleName(): string {
        return this.typeName;
    }

    public getReferenceToSingleUnionType(parsedSingleUnionType: ParsedSingleUnionType): ts.TypeNode {
        return ts.factory.createTypeReferenceNode(this.getReferenceTo(parsedSingleUnionType.getInterfaceName()));
    }

    public getReferenceToUnknownType(): ts.TypeNode {
        return ts.factory.createTypeReferenceNode(
            this.getReferenceTo(UnionModule.UNKNOWN_SINGLE_UNION_TYPE_INTERFACE_NAME)
        );
    }

    public getReferenceToVisitorInterface(): ts.EntityName {
        return this.getReferenceTo(UnionVisitHelper.VISITOR_INTERFACE_NAME);
    }

    private getReferenceTo(name: string): ts.EntityName {
        return ts.factory.createQualifiedName(
            ts.factory.createIdentifier(this.getModuleName()),
            ts.factory.createIdentifier(name)
        );
    }
}

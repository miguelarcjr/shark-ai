import { Project, SourceFile, ClassDeclaration, SyntaxKind } from 'ts-morph';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { CodeEditor, ClassOptions } from '../interfaces/code-editor.interface.js';
import {
    CodeStructure,
    ClassInfo,
    MethodInfo,
    PropertyInfo
} from '../interfaces/structure.types.js';

export class TypeScriptEditor implements CodeEditor {
    private project: Project;

    constructor() {
        this.project = new Project({
            skipAddingFilesFromTsConfig: true,
            compilerOptions: {
                target: 99, // ESNext
                module: 99, // ESNext
            },
        });
    }

    /**
     * Get or add source file to project
     */
    private getSourceFile(filePath: string): SourceFile {
        const absolutePath = path.resolve(filePath);

        // Check if already in project
        let sourceFile = this.project.getSourceFile(absolutePath);

        if (!sourceFile) {
            if (!fs.existsSync(absolutePath)) {
                throw new Error(`File not found: ${absolutePath}`);
            }
            sourceFile = this.project.addSourceFileAtPath(absolutePath);
        }

        return sourceFile;
    }

    /**
     * Get class declaration by name
     */
    private getClass(sourceFile: SourceFile, className: string): ClassDeclaration {
        const classDecl = sourceFile.getClass(className);
        if (!classDecl) {
            throw new Error(`Class "${className}" not found in ${sourceFile.getFilePath()}`);
        }
        return classDecl;
    }

    // ═══════════════════════════════════════════════════════
    // IMPLEMENTATION: listStructure
    // ═══════════════════════════════════════════════════════

    async listStructure(filePath: string): Promise<CodeStructure> {
        const sourceFile = this.getSourceFile(filePath);

        // Extract classes
        const classes: ClassInfo[] = sourceFile.getClasses().map(cls => ({
            name: cls.getName() || '<anonymous>',
            methods: cls.getMethods().map(m => this.extractMethodInfo(m)),
            properties: cls.getProperties().map(p => this.extractPropertyInfo(p)),
            decorators: cls.getDecorators().map(d => d.getText()),
            extendsClass: cls.getExtends()?.getText(),
            implementsInterfaces: cls.getImplements().map(i => i.getText()),
        }));

        // Extract interfaces
        const interfaces = sourceFile.getInterfaces().map(iface => ({
            name: iface.getName(),
            properties: iface.getProperties().map(p => this.extractPropertyInfo(p)),
            extends: iface.getExtends().map(e => e.getText()),
        }));

        // Extract functions
        const functions = sourceFile.getFunctions().map(fn => ({
            name: fn.getName() || '<anonymous>',
            parameters: fn.getParameters().map(p => ({
                name: p.getName(),
                type: p.getType().getText(),
                isOptional: p.isOptional(),
            })),
            returnType: fn.getReturnType().getText(),
            isAsync: fn.isAsync(),
            isExported: fn.isExported(),
        }));

        // Extract imports
        const imports = sourceFile.getImportDeclarations().map(imp => ({
            modulePath: imp.getModuleSpecifierValue(),
            isDefault: !!imp.getDefaultImport(),
            namedImports: imp.getNamedImports().map(n => n.getName()),
            namespaceImport: imp.getNamespaceImport()?.getText(),
        }));

        // Extract exports
        const exports = sourceFile.getExportedDeclarations();
        const exportInfo = Array.from(exports.entries()).flatMap(([name, declarations]) =>
            declarations.map(decl => ({
                name,
                type: this.getDeclarationType(decl),
                isDefault: sourceFile.getDefaultExportSymbol()?.getName() === name,
            }))
        );

        return {
            classes,
            interfaces,
            functions,
            imports,
            exports: exportInfo,
        };
    }

    private extractMethodInfo(method: any): MethodInfo {
        return {
            name: method.getName(),
            parameters: method.getParameters().map((p: any) => ({
                name: p.getName(),
                type: p.getType().getText(),
                isOptional: p.isOptional(),
            })),
            returnType: method.getReturnType().getText(),
            isAsync: method.isAsync(),
            isStatic: method.isStatic(),
            visibility: this.getVisibility(method),
            decorators: method.getDecorators().map((d: any) => d.getText()),
        };
    }

    private extractPropertyInfo(property: any): PropertyInfo {
        return {
            name: property.getName(),
            type: property.getType()?.getText(),
            visibility: this.getVisibility(property),
            isReadonly: property.isReadonly(),
            initializer: property.getInitializer()?.getText(),
        };
    }

    private getVisibility(node: any): 'public' | 'private' | 'protected' {
        if (node.hasModifier?.(SyntaxKind.PrivateKeyword)) return 'private';
        if (node.hasModifier?.(SyntaxKind.ProtectedKeyword)) return 'protected';
        return 'public';
    }

    private getDeclarationType(decl: any): 'class' | 'function' | 'interface' | 'type' | 'const' {
        if (decl.getKind() === SyntaxKind.ClassDeclaration) return 'class';
        if (decl.getKind() === SyntaxKind.FunctionDeclaration) return 'function';
        if (decl.getKind() === SyntaxKind.InterfaceDeclaration) return 'interface';
        if (decl.getKind() === SyntaxKind.TypeAliasDeclaration) return 'type';
        return 'const';
    }

    // ═══════════════════════════════════════════════════════
    // IMPLEMENTATION: Class Operations
    // ═══════════════════════════════════════════════════════

    async addClass(
        filePath: string,
        className: string,
        options?: ClassOptions
    ): Promise<boolean> {
        try {
            const sourceFile = this.getSourceFile(filePath);

            sourceFile.addClass({
                name: className,
                extends: options?.extendsClass,
                implements: options?.implementsInterfaces,
                isExported: true,
            });

            await sourceFile.save();
            return true;
        } catch (error) {
            console.error(`Failed to add class "${className}":`, error);
            return false;
        }
    }

    async addProperty(
        filePath: string,
        className: string,
        propertyCode: string
    ): Promise<boolean> {
        try {
            const sourceFile = this.getSourceFile(filePath);
            const classDecl = this.getClass(sourceFile, className);

            // Using insertText directly to support full property definitions
            const closeBrace = classDecl.getEnd() - 1;
            classDecl.insertText(closeBrace, `\n  ${propertyCode}`);

            // Reformat
            classDecl.formatText();

            await sourceFile.save();
            return true;
        } catch (error) {
            console.error(`Failed to add property to "${className}":`, error);
            return false;
        }
    }

    async modifyProperty(
        filePath: string,
        className: string,
        propertyName: string,
        newCode: string
    ): Promise<boolean> {
        try {
            const sourceFile = this.getSourceFile(filePath);
            const classDecl = this.getClass(sourceFile, className);

            const property = classDecl.getProperty(propertyName);
            if (!property) {
                throw new Error(`Property "${propertyName}" not found in class "${className}"`);
            }

            // Replace the entire property text
            property.replaceWithText(newCode);

            // Reformat
            classDecl.formatText();

            await sourceFile.save();
            return true;
        } catch (error) {
            console.error(`Failed to modify property "${propertyName}":`, error);
            return false;
        }
    }

    async removeProperty(
        filePath: string,
        className: string,
        propertyName: string
    ): Promise<boolean> {
        try {
            const sourceFile = this.getSourceFile(filePath);
            const classDecl = this.getClass(sourceFile, className);

            const property = classDecl.getProperty(propertyName);
            if (!property) {
                throw new Error(`Property "${propertyName}" not found in class "${className}"`);
            }

            property.remove();
            await sourceFile.save();
            return true;
        } catch (error) {
            console.error(`Failed to remove property "${propertyName}":`, error);
            return false;
        }
    }

    async addMethod(
        filePath: string,
        className: string,
        methodCode: string
    ): Promise<boolean> {
        try {
            const sourceFile = this.getSourceFile(filePath);
            const classDecl = this.getClass(sourceFile, className);

            // Method code is likely "methodName(...) { ... }"
            // We can insert this as text.
            const closeBrace = classDecl.getEnd() - 1;
            classDecl.insertText(closeBrace, `\n  ${methodCode}\n`);

            classDecl.formatText();

            await sourceFile.save();
            return true;
        } catch (error) {
            console.error(`Failed to add method to "${className}":`, error);
            return false;
        }
    }

    async modifyMethod(
        filePath: string,
        className: string,
        methodName: string,
        newBody: string
    ): Promise<boolean> {
        try {
            const sourceFile = this.getSourceFile(filePath);
            const classDecl = this.getClass(sourceFile, className);

            const method = classDecl.getMethod(methodName);
            if (!method) {
                throw new Error(`Method "${methodName}" not found in class "${className}"`);
            }

            method.setBodyText(newBody);

            // Optional: reformat
            method.formatText();

            await sourceFile.save();
            return true;
        } catch (error) {
            console.error(`Failed to modify method "${methodName}":`, error);
            return false;
        }
    }

    async removeMethod(
        filePath: string,
        className: string,
        methodName: string
    ): Promise<boolean> {
        try {
            const sourceFile = this.getSourceFile(filePath);
            const classDecl = this.getClass(sourceFile, className);

            const method = classDecl.getMethod(methodName);
            if (!method) {
                throw new Error(`Method "${methodName}" not found in class "${className}"`);
            }

            method.remove();
            await sourceFile.save();
            return true;
        } catch (error) {
            console.error(`Failed to remove method "${methodName}":`, error);
            return false;
        }
    }

    async addDecorator(
        filePath: string,
        className: string,
        decoratorCode: string
    ): Promise<boolean> {
        try {
            const sourceFile = this.getSourceFile(filePath);
            const classDecl = this.getClass(sourceFile, className);

            // Robust text-based insertion
            const start = classDecl.getStart();
            // Prefix the class with the decorator
            sourceFile.insertText(start, `${decoratorCode}\n`);
            sourceFile.formatText();

            await sourceFile.save();
            return true;
        } catch (error) {
            console.error(`Failed to add decorator to "${className}":`, error);
            return false;
        }
    }

    async getMethod(
        filePath: string,
        className: string,
        methodName: string
    ): Promise<string | undefined> {
        try {
            const sourceFile = this.getSourceFile(filePath);
            const classDecl = this.getClass(sourceFile, className);

            const method = classDecl.getMethod(methodName);
            if (!method) {
                return undefined;
            }

            return method.getText();
        } catch (error) {
            console.error(`Failed to get method "${methodName}":`, error);
            return undefined;
        }
    }

    // ═══════════════════════════════════════════════════════
    // IMPLEMENTATION: Interface/Type Operations
    // ═══════════════════════════════════════════════════════

    async addInterface(filePath: string, interfaceCode: string): Promise<boolean> {
        try {
            const sourceFile = this.getSourceFile(filePath);

            // Add at the end of file
            sourceFile.insertText(sourceFile.getEnd(), `\n\n${interfaceCode}`);
            sourceFile.formatText();

            await sourceFile.save();
            return true;
        } catch (error) {
            console.error(`Failed to add interface:`, error);
            return false;
        }
    }

    async addTypeAlias(filePath: string, typeCode: string): Promise<boolean> {
        try {
            const sourceFile = this.getSourceFile(filePath);
            sourceFile.insertText(sourceFile.getEnd(), `\n\n${typeCode}`);
            sourceFile.formatText();
            await sourceFile.save();
            return true;
        } catch (error) {
            console.error(`Failed to add type alias:`, error);
            return false;
        }
    }

    // ═══════════════════════════════════════════════════════
    // IMPLEMENTATION: Function Operations
    // ═══════════════════════════════════════════════════════

    async addFunction(filePath: string, functionCode: string): Promise<boolean> {
        try {
            const sourceFile = this.getSourceFile(filePath);
            sourceFile.insertText(sourceFile.getEnd(), `\n\n${functionCode}`);
            sourceFile.formatText();
            await sourceFile.save();
            return true;
        } catch (error) {
            console.error(`Failed to add function:`, error);
            return false;
        }
    }

    async removeFunction(filePath: string, functionName: string): Promise<boolean> {
        try {
            const sourceFile = this.getSourceFile(filePath);

            const func = sourceFile.getFunction(functionName);
            if (!func) {
                throw new Error(`Function "${functionName}" not found`);
            }

            func.remove();
            await sourceFile.save();
            return true;
        } catch (error) {
            console.error(`Failed to remove function "${functionName}":`, error);
            return false;
        }
    }

    // ═══════════════════════════════════════════════════════
    // IMPLEMENTATION: Import/Export Operations
    // ═══════════════════════════════════════════════════════

    async addImport(filePath: string, importStatement: string): Promise<boolean> {
        try {
            const sourceFile = this.getSourceFile(filePath);

            const lastImport = sourceFile.getImportDeclarations().pop();
            const pos = lastImport ? lastImport.getEnd() : 0;

            sourceFile.insertText(pos, `\n${importStatement}`);

            // Organize to clean up
            this.organizeImports(filePath);

            await sourceFile.save();
            return true;
        } catch (error) {
            console.error(`Failed to add import:`, error);
            return false;
        }
    }

    async removeImport(filePath: string, modulePath: string): Promise<boolean> {
        try {
            const sourceFile = this.getSourceFile(filePath);

            const importDecls = sourceFile.getImportDeclarations()
                .filter(imp => imp.getModuleSpecifierValue() === modulePath);

            if (importDecls.length === 0) {
                throw new Error(`Import from "${modulePath}" not found`);
            }

            importDecls.forEach(d => d.remove());
            await sourceFile.save();
            return true;
        } catch (error) {
            console.error(`Failed to remove import from "${modulePath}":`, error);
            return false;
        }
    }

    async organizeImports(filePath: string): Promise<boolean> {
        try {
            const sourceFile = this.getSourceFile(filePath);

            sourceFile.organizeImports();

            // Fallback manual just in case:
            const imports = sourceFile.getImportDeclarations();
            const importStructure = imports.map(i => i.getStructure());

            // Sort by module specifier
            importStructure.sort((a, b) => {
                return a.moduleSpecifier.localeCompare(b.moduleSpecifier);
            });

            // Remove all
            imports.forEach(i => i.remove());

            // Re-add
            sourceFile.addImportDeclarations(importStructure);

            await sourceFile.save();
            return true;
        } catch (error) {
            console.error(`Failed to organize imports:`, error);
            return false;
        }
    }
}

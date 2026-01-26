/**
 * Abstract interface for code editors supporting AST-based operations.
 * Implementations exist for specific languages (TypeScript, HTML, etc.)
 */
import { CodeStructure } from './structure.types.js';

export interface CodeEditor {
    /**
     * Returns the structured representation of a code file
     */
    listStructure(filePath: string): Promise<CodeStructure>;

    /**
     * Adds a new class to the file
     */
    addClass(
        filePath: string,
        className: string,
        options?: ClassOptions
    ): Promise<boolean>;

    /**
     * Adds a property/field to an existing class
     */
    addProperty(
        filePath: string,
        className: string,
        propertyCode: string
    ): Promise<boolean>;

    /**
     * Gets the content of an existing property
     */
    getProperty(
        filePath: string,
        className: string,
        propertyName: string
    ): Promise<string | undefined>;

    /**
     * Removes a property from a class
     */
    removeProperty(
        filePath: string,
        className: string,
        propertyName: string
    ): Promise<boolean>;

    /**
     * Modifies an existing property in a class
     */
    modifyProperty(
        filePath: string,
        className: string,
        propertyName: string,
        newCode: string
    ): Promise<boolean>;

    /**
     * Adds a method to an existing class
     */
    addMethod(
        filePath: string,
        className: string,
        methodCode: string
    ): Promise<boolean>;

    /**
     * Gets the content of an existing method
     */
    getMethod(
        filePath: string,
        className: string,
        methodName: string
    ): Promise<string | undefined>;

    /**
     * Modifies the body of an existing method (keeps signature)
     */
    modifyMethod(
        filePath: string,
        className: string,
        methodName: string,
        newBody: string
    ): Promise<boolean>;

    /**
     * Removes a method from a class
     */
    removeMethod(
        filePath: string,
        className: string,
        methodName: string
    ): Promise<boolean>;

    /**
     * Adds a decorator to a class or method (TypeScript/Angular specific)
     */
    addDecorator(
        filePath: string,
        className: string,
        decoratorCode: string
    ): Promise<boolean>;

    /**
     * Adds an interface to the file (TypeScript specific)
     */
    addInterface(
        filePath: string,
        interfaceCode: string
    ): Promise<boolean>;

    /**
     * Adds a type alias (TypeScript specific)
     */
    addTypeAlias(
        filePath: string,
        typeCode: string
    ): Promise<boolean>;

    /**
     * Adds a standalone function (not in a class)
     */
    addFunction(
        filePath: string,
        functionCode: string
    ): Promise<boolean>;

    /**
     * Removes a standalone function
     */
    removeFunction(
        filePath: string,
        functionName: string
    ): Promise<boolean>;

    /**
     * Adds an import statement
     */
    addImport(
        filePath: string,
        importStatement: string
    ): Promise<boolean>;

    /**
     * Removes an import by module path
     */
    removeImport(
        filePath: string,
        modulePath: string
    ): Promise<boolean>;

    /**
     * Organizes imports (remove unused, sort alphabetically)
     */
    organizeImports(filePath: string): Promise<boolean>;
}

export interface ClassOptions {
    extendsClass?: string;
    implementsInterfaces?: string[];
}

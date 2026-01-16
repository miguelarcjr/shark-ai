/**
 * Return type for listStructure operation
 */
export interface CodeStructure {
    classes: ClassInfo[];
    interfaces: InterfaceInfo[];
    functions: FunctionInfo[];
    imports: ImportInfo[];
    exports: ExportInfo[];
}

export interface ClassInfo {
    name: string;
    methods: MethodInfo[];
    properties: PropertyInfo[];
    decorators: string[];
    extendsClass?: string;
    implementsInterfaces: string[];
}

export interface MethodInfo {
    name: string;
    parameters: ParameterInfo[];
    returnType?: string;
    isAsync: boolean;
    isStatic: boolean;
    visibility: 'public' | 'private' | 'protected';
    decorators: string[];
}

export interface PropertyInfo {
    name: string;
    type?: string;
    visibility: 'public' | 'private' | 'protected';
    isReadonly: boolean;
    initializer?: string;
}

export interface ParameterInfo {
    name: string;
    type?: string;
    isOptional: boolean;
}

export interface InterfaceInfo {
    name: string;
    properties: PropertyInfo[];
    extends: string[];
}

export interface FunctionInfo {
    name: string;
    parameters: ParameterInfo[];
    returnType?: string;
    isAsync: boolean;
    isExported: boolean;
}

export interface ImportInfo {
    modulePath: string;
    isDefault: boolean;
    namedImports: string[];
    namespaceImport?: string;
}

export interface ExportInfo {
    name: string;
    type: 'class' | 'function' | 'interface' | 'type' | 'const';
    isDefault: boolean;
}

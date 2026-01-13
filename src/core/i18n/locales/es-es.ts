import { Locale } from "../types.js";

export const esEs: Locale = {
    common: {
        loading: 'Cargando...',
        success: 'Éxito',
        error: 'Error',
        cancel: 'Cancelar',
        operationCancelled: 'Operación cancelada.'
    },
    commands: {
        config: {
            title: 'Configuración Shark AI',
            selectAction: '¿Qué desea configurar?',
            actions: {
                language: 'Cambiar Idioma',
                logLevel: 'Nivel de Log',
                agents: 'Configurar Agentes',
                back: 'Volver'
            },
            selectLanguage: 'Seleccione el idioma:',
            agentMenu: {
                title: 'Configuración de Agentes',
                selectAgent: '¿Qué agente desea configurar?',
                enterId: 'Ingrese el ID del Agente StackSpot (o dejar vacío para predeterminado):',
                updated: 'ID del Agente {0} actualizado.',
                options: {
                    dev: 'Agente Desarrollador',
                    ba: 'Analista de Negocios',
                    spec: 'Agente de Especificación',
                    qa: 'Agente de QA',
                    scan: 'Agente de Escaneo',
                    back: 'Volver'
                }
            },
            languageUpdated: 'Idioma actualizado a: {0}'
        },
        login: {
            intro: 'Login StackSpot',
            alreadyLoggedIn: 'Ya has iniciado sesión',
            success: '¡Inicio de sesión exitoso!',
            error: 'Error de inicio de sesión'
        },
        scan: {
            intro: '🕵️‍♂️  Agente de Escaneo',
            scanningProject: 'Escaneando proyecto en:',
            outputTarget: 'Archivo de salida:',
            language: 'Idioma:',
            templateCreated: '✅ Plantilla creada en:',
            fileExists: '📄 El archivo ya existe, será actualizado',
            analyzing: '🕵️‍♂️  Agente de escaneo analizando (Paso {step})...',
            completed: '✨ Escaneo completado exitosamente!',
            error: 'Error al ejecutar escaneo'
        }
    }
};

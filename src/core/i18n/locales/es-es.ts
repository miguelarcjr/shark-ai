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
                back: 'Volver'
            },
            selectLanguage: 'Seleccione el idioma:',
            languageUpdated: 'Idioma actualizado a: {0}'
        },
        login: {
            intro: 'Login StackSpot',
            alreadyLoggedIn: 'Ya has iniciado sesión',
            success: '¡Inicio de sesión exitoso!',
            error: 'Error de inicio de sesión'
        }
    }
};

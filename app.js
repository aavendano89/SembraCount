const app = {
    state: {
        operario: null,
        bodega: null,
        ubicacion: null,
        inventario: [] // Estructura: array de objetos { sku: string, qty: number }
    },
    
    init: function() {
        this.bindEvents();
        this.loadState();
        this.updateNetworkStatus();
        
        // Listeners para detectar conexión online/offline
        window.addEventListener('online', () => this.updateNetworkStatus());
        window.addEventListener('offline', () => this.updateNetworkStatus());

        // Si hay un estado previo cargado (ej. refrescar sesión), ir a resumen directamente si hay datos
        if(this.state.operario && this.state.bodega) {
            document.getElementById('label-bodega').innerText = this.state.bodega;
            document.getElementById('label-ubicacion').innerText = this.state.ubicacion;
            this.navigate('screen-scan');
        }
    },

    bindEvents: function() {
        document.getElementById('btn-login').addEventListener('click', () => this.handleLogin());
        
        const skuInput = document.getElementById('input-sku');
        skuInput.addEventListener('keypress', (e) => {
            if(e.key === 'Enter') {
                this.handleScan(skuInput.value);
            }
        });

        // Ingreso Manual
        document.getElementById('btn-manual-entry').addEventListener('click', () => {
            Swal.fire({
                title: 'Ingreso Manual',
                text: 'Ingresa el SKU si el producto no tiene etiqueta.',
                input: 'text',
                inputPlaceholder: 'Ingresa SKU',
                showCancelButton: true,
                confirmButtonText: 'Buscar/Agregar',
                cancelButtonText: 'Cancelar',
                inputAttributes: {
                    autocapitalize: 'off',
                    autocorrect: 'off'
                }
            }).then((result) => {
                if(result.isConfirmed && result.value) {
                    this.handleScan(result.value);
                }
            });
        });

        // Re-imprimir ZPL
        document.getElementById('btn-print-zpl').addEventListener('click', () => {
            Swal.fire({
                title: 'Re-etiquetar Producto',
                text: 'Ingresa el SKU a imprimir mediante comando ZPL a la impresora Zebra de la bodega.',
                input: 'text',
                showCancelButton: true,
                confirmButtonText: 'Imprimir',
                confirmButtonColor: '#eab308' // Yellow
            }).then((result) => {
                if(result.isConfirmed && result.value) {
                    this.printZPL(result.value);
                }
            })
        });

        // Reportes y Sincronización
        document.getElementById('btn-pdf-download').addEventListener('click', () => this.generatePDF());
        document.getElementById('btn-print-report').addEventListener('click', () => window.print());
        document.getElementById('btn-sync-sap').addEventListener('click', () => this.syncSAP());
    },

    // Cargar y guardar en localStorage
    loadState: function() {
        const saved = localStorage.getItem('sembraCount_state');
        if (saved) {
            this.state = JSON.parse(saved);
        }
    },

    saveState: function() {
        localStorage.setItem('sembraCount_state', JSON.stringify(this.state));
        this.updateSummaryBadge();
    },

    // UI: Actualizar indicador de red
    updateNetworkStatus: function() {
        const indicator = document.getElementById('connection-status');
        const warning = document.getElementById('label-offline-warning');
        if(navigator.onLine) {
            indicator.classList.replace('bg-red-500', 'bg-green-400');
            if(warning) warning.classList.add('hidden');
        } else {
            indicator.classList.replace('bg-green-400', 'bg-red-500');
            if(warning) warning.classList.remove('hidden');
        }
    },

    // UI: Navegación simple entre secciones
    navigate: function(screenId) {
        document.querySelectorAll('.screen, .screen-auth').forEach(s => {
            s.classList.remove('active');
            s.classList.add('hidden');
        });
        
        const target = document.getElementById(screenId);
        target.classList.remove('hidden');
        target.classList.add('active');

        // Acciones específicas al abir ciertas pantallas
        if(screenId === 'screen-scan') {
            document.getElementById('input-sku').focus();
            this.updateSummaryBadge();
        } else if (screenId === 'screen-summary') {
            this.renderSummaryTable();
        } else if (screenId === 'screen-login') {
            document.getElementById('input-pin').value = '';
        }
    },

    handleLogin: function() {
        const pin = document.getElementById('input-pin').value;
        const bodega = document.getElementById('select-bodega').value;
        const ubi = document.getElementById('select-ubicacion').value;

        if(!pin || !bodega || !ubi) {
            Swal.fire('Error', 'Debe ingresar PIN, Bodega y Ubicación.', 'error');
            return;
        }

        this.state.operario = pin;
        this.state.bodega = bodega;
        this.state.ubicacion = ubi;
        this.saveState();

        document.getElementById('label-bodega').innerText = bodega;
        document.getElementById('label-ubicacion').innerText = ubi;

        this.navigate('screen-scan');
    },

    handleScan: async function(rawSku) {
        if(!rawSku) return;
        const sku = rawSku.trim().toUpperCase();
        document.getElementById('input-sku').value = '';

        const existingItemIndex = this.state.inventario.findIndex(i => i.sku === sku);

        if(existingItemIndex > -1) {
            // Lógica de Duplicados
            const { value: action } = await Swal.fire({
                title: 'Producto ya contado',
                html: `<p class="text-xl">El SKU <b class="text-blue-600">${sku}</b> ya está en la lista con cantidad <b class="text-red-500 text-2xl">${this.state.inventario[existingItemIndex].qty}</b>.</p><br>¿Qué deseas hacer?`,
                icon: 'warning',
                showDenyButton: true,
                showCancelButton: true,
                confirmButtonText: 'SUMAR cantidad',
                confirmButtonColor: '#3b82f6', // blue-500
                denyButtonText: 'REEMPLAZAR',
                denyButtonColor: '#ef4444', // red-500
                cancelButtonText: 'Cancelar'
            });

            if (action === true) {
                // Sumar
                this.promptQuantity(sku, (qty) => {
                    this.state.inventario[existingItemIndex].qty += qty;
                    this.saveState();
                    Swal.fire({
                        title: 'Actualizado', 
                        text: `Cantidad sumada. Nuevo total: ${this.state.inventario[existingItemIndex].qty}`, 
                        icon: 'success', timer: 1500, showConfirmButton: false
                    });
                });
            } else if (action === false) {
                // Reemplazar
                this.promptQuantity(sku, (qty) => {
                    this.state.inventario[existingItemIndex].qty = qty;
                    this.saveState();
                    Swal.fire({
                        title: 'Actualizado', 
                        text: `Nueva cantidad establecida: ${this.state.inventario[existingItemIndex].qty}`, 
                        icon: 'success', timer: 1500, showConfirmButton: false
                    });
                });
            }
        } else {
            // Producto nuevo, solicitar cantidad
            this.promptQuantity(sku, (qty) => {
                // Agregar al inicio del array para que aparezca arriba en la tabla
                this.state.inventario.unshift({ sku, qty });
                this.saveState();
                
                Swal.fire({
                    title: 'Agregado Correctamente',
                    text: `${qty}x unidades de ${sku}`,
                    icon: 'success',
                    timer: 1000,
                    showConfirmButton: false
                });
            });
        }
        
        document.getElementById('input-sku').focus();
    },

    // Modal con teclado tipo número grande para elegir cantidades
    promptQuantity: function(sku, callback) {
        Swal.fire({
            title: `Cantidad para ${sku}`,
            input: 'number',
            inputAttributes: {
                min: 1,
                step: 1,
                // inputmode para forzar teclado numérico en móviles
                inputmode: 'numeric'
            },
            inputValue: 1,
            showCancelButton: true,
            confirmButtonText: 'Confirmar',
            confirmButtonColor: '#22c55e',
            cancelButtonText: 'Cancelar'
        }).then((result) => {
            if(result.isConfirmed && result.value) {
                const q = parseInt(result.value, 10);
                if(q > 0) callback(q);
            } else {
                document.getElementById('input-sku').focus();
            }
        });
    },

    updateSummaryBadge: function() {
        const badge = document.getElementById('badge-count');
        if(badge) {
            const totalItems = this.state.inventario.length;
            const totalQty = this.state.inventario.reduce((acc, curr) => acc + curr.qty, 0);
            badge.innerText = `${totalItems} items (${totalQty} uds)`;
        }
    },

    renderSummaryTable: function() {
        const tbody = document.getElementById('table-body-summary');
        tbody.innerHTML = '';

        if(this.state.inventario.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" class="p-6 text-center text-gray-500">No hay productos contados.</td></tr>`;
            return;
        }

        this.state.inventario.forEach((item, index) => {
            const tr = document.createElement('tr');
            tr.className = "border-b active:bg-blue-50 transition";
            tr.innerHTML = `
                <td class="p-4 font-mono font-bold text-lg text-gray-800" onclick="app.editRow(${index})">${item.sku}</td>
                <td class="p-4 text-center text-2xl font-bold text-blue-600" onclick="app.editRow(${index})">${item.qty}</td>
                <td class="p-4 text-center">
                    <button onclick="app.deleteRow(${index})" class="text-red-500 p-3 rounded-xl bg-red-100 font-bold active:bg-red-200 shadow-sm transition">
                        Borrar
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    editRow: function(index) {
        const item = this.state.inventario[index];
        this.promptQuantity(item.sku, (qty) => {
            this.state.inventario[index].qty = qty;
            this.saveState();
            this.renderSummaryTable();
        });
    },

    deleteRow: function(index) {
        Swal.fire({
            title: '¿Eliminar fila?',
            text: `Seguro que deseas eliminar el registro de ${this.state.inventario[index].sku}?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            confirmButtonText: 'Sí, eliminar',
            cancelButtonText: 'Cancelar'
        }).then((result) => {
            if (result.isConfirmed) {
                this.state.inventario.splice(index, 1);
                this.saveState();
                this.renderSummaryTable();
            }
        });
    },

    printZPL: function(sku) {
        // En un caso real, esto enviaría un fetch o WebBluetooth al servidor de print/impresora
        console.log(`[ZPL COMAND] ^XA^FO50,50^ADN,36,20^FD${sku}^FS^XZ`);
        Swal.fire('ZPL Enviado', `Comando de impresión para la etiqueta del producto ${sku} enviado a la impresora de la bodega.`, 'info');
    },

    generatePDF: function() {
        // Usa jsPDF desde window.jspdf
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // Títulos de cabecera
        doc.setFontSize(22);
        doc.setTextColor(37, 99, 235); // azul Tailwind
        doc.text('SembraCount - Reporte de Inventario', 14, 22);
        
        doc.setFontSize(12);
        doc.setTextColor(50, 50, 50);
        doc.text(`Fecha: ${new Date().toLocaleString()}`, 14, 32);
        doc.text(`Bodega: ${this.state.bodega}`, 14, 38);
        doc.text(`Ubicación: ${this.state.ubicacion}`, 14, 44);
        doc.text(`Operario PIN: ${this.state.operario}`, 14, 50);

        // Resumen total
        const totalItems = this.state.inventario.length;
        const totalQty = this.state.inventario.reduce((acc, curr) => acc + curr.qty, 0);
        doc.text(`Total SKU distintos: ${totalItems} | Unidades Físicas: ${totalQty}`, 14, 58);

        // Tabla con plugin AutoTable
        const tableBody = this.state.inventario.map(i => [i.sku, i.qty]);
        doc.autoTable({
            startY: 65,
            head: [['Código Producto (SKU)', 'Cantidad Contada']],
            body: tableBody,
            theme: 'grid',
            headStyles: { fillColor: [37, 99, 235] },
            styles: { fontSize: 12, cellPadding: 4 }
        });

        // Áreas de firma
        const finalY = doc.lastAutoTable.finalY || 65;
        const spaceForSign = 40;
        
        // Checkear si hay espacio para firmas, si no añadir página
        if (finalY + spaceForSign > doc.internal.pageSize.height) {
            doc.addPage();
        }

        const signY = (finalY + spaceForSign > doc.internal.pageSize.height) ? 40 : finalY + spaceForSign;

        doc.setDrawColor(0);
        doc.setLineWidth(0.5);
        
        doc.line(20, signY, 80, signY); // Linea firma 1
        doc.text('Firma del Operario', 30, signY + 6);

        doc.line(120, signY, 190, signY); // Linea firma 2
        doc.text('Firma del Supervisor', 135, signY + 6);

        // Guardado PDF
        const filename = `Reporte_${this.state.bodega}_${new Date().getTime()}.pdf`;
        doc.save(filename);
        
        Swal.fire('PDF Generado', `El documento ${filename} ha sido guardado exitosamente.`, 'success');
    },

    syncSAP: async function() {
        if (!navigator.onLine) {
            Swal.fire({
                title: 'Conexión Estática',
                text: 'No tienes conexión a internet activa. Los datos están guardados en el almacenamiento del equipo de forma segura.',
                icon: 'warning',
                confirmButtonText: 'Entendido'
            });
            return;
        }

        if (this.state.inventario.length === 0) {
            Swal.fire('No hay datos', 'Debe contar al menos un producto para enviar a SAP.', 'info');
            return;
        }

        // Estructura de Payload tipo SAP Service Layer - Objeto: InventoryCountings
        const payload = {
            CountDate: new Date().toISOString().split('T')[0],
            CountTime: new Date().toTimeString().split(' ')[0], // HH:MM:SS
            Remarks: `Toma de inventario desde SembraCount PWA - Bodega ${this.state.bodega} Ubic: ${this.state.ubicacion}`,
            InventoryCountingLines: this.state.inventario.map((item, idx) => ({
                LineNum: idx,
                ItemCode: item.sku,
                CountedQuantity: item.qty,
                WarehouseCode: this.state.bodega
            }))
        };

        try {
            Swal.fire({
                title: 'Sincronizando con SAP...',
                text: 'Creando documento en Service Layer...',
                allowOutsideClick: false,
                didOpen: () => { Swal.showLoading(); }
            });

            /*
            =============================================================================
            SIMULACIÓN DE LLAMADA FETCH A SAP (SE DEBE REEMPLAZAR URL Y COOKIES/TOKENS)
            =============================================================================
             const response = await fetch('https://SU_SERVIDOR_SAP:50000/b1s/v1/InventoryCountings', {
                 method: 'POST',
                 headers: { 
                    'Content-Type': 'application/json', 
                    // Session B1
                    'Cookie': 'B1SESSION=AQUI_VA_EL_TOKEN_DE_SESION...' 
                 },
                 body: JSON.stringify(payload)
             });
             if(!response.ok) {
                 const err = await response.json();
                 throw new Error(err.error?.message?.value || 'Error HTTP: ' + response.status);
             }
             const resultData = await response.json();
            =============================================================================
             */
            
            // Simular el retraso de red
            await new Promise(r => setTimeout(r, 2000)); 

            Swal.fire({
                title: '¡Sincronización Exitosa!',
                text: 'Los registros de conteo han sido creados en SAP Business One.',
                icon: 'success',
                confirmButtonText: 'Cerrar Sesión y Vaciar Contexto'
            }).then(() => {
                // Clear session and restart
                this.state.inventario = [];
                this.state.operario = null;
                this.saveState();
                
                // Limpiar selects del DOM
                document.getElementById('select-bodega').value = '';
                document.getElementById('select-ubicacion').value = '';
                
                this.navigate('screen-login');
            });

        } catch (error) {
            Swal.fire('Error de Sincronización', `Detalle SAP: ${error.message}`, 'error');
        }
    }
};

// Arrancar App
document.addEventListener('DOMContentLoaded', () => {
    app.init();
});

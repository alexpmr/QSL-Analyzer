# Notas de versão

## 0.3.0 - 2026-10-29

- Atualização automática no Windows: o aviso de versão nova oferece "Atualizar agora", que baixa o pacote de www.pt2vhf.com com progresso (percentual, bytes e velocidade), confere tamanho e SHA-256, instala (instalador ou portátil) e reabre o app já atualizado, preservando banco, preferências e credenciais.
- Novidades da versão mostradas uma única vez na primeira abertura depois de atualizar.
- Textos da tela Sobre, créditos e ajudas revisados.

## 0.2.0 - 2026-10-29

- Ficha clicável de indicativos, países/DXCC, quadrículas, prefixos, zonas, continentes e estações: todos os QSOs, slots banda × modo, QSL por banda, estações, quadrículas e mapa.
- Ficha do indicativo com dados do QRZ.com (API XML: foto, nome, QTH, quadrícula, LoTW/eQSL) e HamQTH como alternativa gratuita, com cache local.
- Sem containers: tudo organizado por indicativo de estação; bancos antigos são unificados sem duplicar QSOs.
- Importar logs em um passo, com popup de progresso (importados, ignorados por já existirem, QSL atualizadas); exportação e backup no menu Logs.
- Aba QSL: Diplomas (DXCC Mixed/Phone/CW/Digital e por banda, WAZ, WAS, WPX, VUCC, IOTA), Faltam confirmar e Entidades raras.
- Novas análises: Propagação (meses × países/continentes, horário, alcance e aberturas VHF/UHF), Comparar períodos, Estações frequentes e "sumidas", Novos indicativos e Concursos.
- Dashboard com resumo da sua atividade em linguagem natural.
- Saúde do log: banda × frequência, duplicados próximos, indicativos mal digitados e outros, com correção em lote.
- Plataformas: conferência entre o app e QRZ/LoTW/eQSL/Club Log e sincronização automática ao abrir.
- Filtros recolhidos com chips, painéis de filtros salvos e páginas longas divididas em sub-abas.
- Relatório pronto "Meu ano no rádio".
- Aviso do site oficial no mesmo modelo do Mesh Analyzer; matriz DXCC com colunas alinhadas.
- Nesta versão o pacote publicado é só para Windows (Linux e macOS voltam nas próximas).

## 0.1.0 - 2026-10-29

Primeira versão do PT2VHF QSL Analyzer.

- Banco local de contatos com importação incremental: QSOs já existentes não são duplicados e as confirmações QSL (papel, LoTW, eQSL) são atualizadas.
- Leitura de ADIF (.adi), ADX, Cabrillo 2/3, EDI REG1TEST e CSV; vários arquivos e várias estações de uma vez.
- Importação direta do QRZ.com Logbook, ARRL LoTW, eQSL.cc (Inbox) e Club Log.
- Configurações → Banco de dados: limpeza por indicativo de estação, opcionalmente restrita a um container.
- Menu Logs: containers, enviar, importar, modificar, copiar/filtrar e busca com curingas.
- 20 páginas de estatística e aba QSL com matriz DXCC × banda trabalhado/confirmado.
- Gráficos interativos estilo BI: clique para filtrar, arraste para escolher período, legenda clicável, filtros instantâneos com chips e desfazer.
- Gerador de relatórios personalizável com exportação em PDF e HTML, modelos salvos e comparação entre containers/indicativos.
- Exportação em ADIF v3, CSV, Cabrillo e KML (com replay temporal), backup e restauração do banco.
- Interface em português, inglês e espanhol, tema claro/escuro.
- Pacotes para Windows (instalador e portátil), Linux (AppImage, .deb, .tar.gz) e macOS (.dmg Apple Silicon e Intel).
- Aviso do site oficial www.pt2vhf.com a cada abertura, seguido da verificação de versão nova pelo site.

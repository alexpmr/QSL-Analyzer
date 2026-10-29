# Backlog

Itens solicitados e situação na versão 0.1.0.

| Item | Situação |
|---|---|
| Aplicação "QSL Analyzer" no padrão visual dos projetos PT2VHF | Feito: Electron, cabeçalho com marca/versão, idioma com bandeiras, tema claro/escuro |
| Análise de logs .adif e outros formatos conhecidos | Feito: ADIF, ADX, Cabrillo, EDI, CSV |
| Banco local com novos uploads incrementais (sem duplicar) | Feito |
| Configurações: limpar banco por indicativo | Feito: Configurações → Banco de dados |
| Todos os recursos do QScope (Logs/Containers, Estatísticas, Exportar, Usuário) | Feito: veja o README |
| Menu superior com aba Logs (Containers, Upload, Import, Modify, Copy/Filter, Search) | Feito |
| Aba Estatísticas com as 20 análises | Feito |
| Aba Relatórios com relatório customizável e exportação em PDF | Feito |
| Importação de plataformas como o QRZ.com | Feito: QRZ.com, LoTW, eQSL, Club Log |
| Gráficos de BI "vivos" com interação do usuário | Feito: filtro por clique, período por arraste, legenda interativa, chips, desfazer, animações |
| Publicar no site com versões para Windows, Linux e macOS | Feito: www.pt2vhf.com/qsl, updates.json e update.php |

## Pendentes

- **Backlog (29/10/2026): remover toda relação com o QScope.** Tirar qualquer menção ao QScope/QScope.org
  e ao seu autor do app (textos e ajudas em `src/i18n.mjs`, comentários em `src/stats.mjs`, Sobre/créditos),
  do README e do CHANGELOG (inclusive notas de versões anteriores) e da página do QSL Analyzer no site
  (`products.js` e traduções em `assets/js/locales/*`). Reescrever os textos sem a referência, de forma
  natural. Não registrar em nenhum texto público (changelog, notas da versão, página) que a referência foi
  retirada.
- **Backlog (29/10/2026): página do QSL Analyzer no site com screenshots e changelog no fim.** A galeria de
  screenshots e o histórico de versões (changelog completo, versão a versão) aparecem no fim da página `/qsl`.

## Resolvidos na 0.2.0 (29/10/2026)

- **[Resolvido] Roadmap (29/10/2026): indicativo clicável em toda a aplicação.** Sempre que um indicativo aparecer
  (por exemplo, a lista de Estações trabalhadas, Busca no log, duplicados, pontos, DXCC first worked,
  QSOs mais distantes, dashboard), ele deve ser clicável e abrir tudo sobre aquela estação nos meus
  contatos: todos os QSOs (data/hora, banda, modo, RST, frequência, container, estação/operador),
  bandas e modos trabalhados, slots, primeiro e último contato, país/DXCC, zonas, quadrícula, distância
  e azimute, e status de QSL (papel, LoTW, eQSL) de cada QSO.
- **[Resolvido] Backlog (29/10/2026): omitir containers e organizar só por estação.** Os containers não devem
  aparecer para o usuário: todos os ADIFs enviados, de qualquer estação, ficam num único container
  interno, e a organização visível é apenas por estação (indicativo/STATION_CALLSIGN). Ajustar: menu Logs
  (sem "Gerenciar containers" e sem escolha de container na importação, em Copiar/filtrar, Modificar e
  plataformas), barra de filtros (sem o filtro Container), dashboard, banco de dados (limpeza só por
  indicativo, sem "Restringir ao container"), Comparar (só estações), busca e textos de ajuda/README.
  A importação incremental continua sem duplicar QSOs (mesma estação, indicativo, banda, modo e minuto).
  Bancos já existentes com mais de um container devem ser unidos no container único, sem duplicar QSOs.
- **[Resolvido] Backlog (29/10/2026): importar e exportar juntos.** A aba Exportar saiu do menu superior (29/10/2026):
  "Exportar logs" e "Backup do banco" agora ficam no menu Logs. Importação e exportação ficam juntas no
  menu Logs, onde o usuário tanto importa logs para o app (arquivos ADIF e demais
  formatos, e plataformas online) quanto exporta. Na importação, os contatos que já existirem no banco são
  ignorados. Durante a importação abre um popup com a barra de progresso e as contagens, atualizadas em
  tempo real, de contatos importados e de contatos ignorados por já existirem (e o total processado), com
  o resumo final ao terminar.
- **[Resolvido] Backlog (29/10/2026): aviso do site oficial igual ao do Mesh Analyzer.** Trocar o diálogo exibido a
  cada abertura pelo mesmo modelo do PT2VHF Mesh Analyzer: título "Downloads no site oficial"; texto
  "A partir de agora, as novas versões e os instaladores do PT2VHF QSL Analyzer serão distribuídos pelo
  site oficial."; link sublinhado "www.PT2VHF.com" (abre o site); um único botão "Entendi" alinhado à
  direita (com foco). Mesmo visual: cartão escuro com cantos arredondados e borda clara, título em
  negrito, sem os botões "Abrir o site"/"Continuar" atuais. Traduzir para inglês e espanhol. O aviso de
  versão nova continua aparecendo logo depois de fechar este.
- **[Resolvido] Backlog (29/10/2026): melhorias de análise dos contatos.** Aprovadas pelo mantenedor; prioridade
  sugerida nesta ordem: progresso de diplomas com "faltam confirmar", resumo em linguagem natural e
  saúde do log.
  1. **Progresso de diplomas:** DXCC (Mixed, Phone, CW, Digital e por banda), WAS, WAZ, WPX, VUCC
     (quadrículas VHF/UHF) e IOTA, com trabalhado, confirmado e o que falta (lista do que falta).
  2. **"Faltam confirmar":** entidades trabalhadas e não confirmadas, com o melhor QSO de cada uma para
     pedir QSL.
  3. **Entidades raras:** destacar as entidades mais procuradas (Most Wanted do Club Log) já trabalhadas.
  4. **"Sua atividade" em linguagem natural no Dashboard:** resumo automático (totais do período, modo
     predominante, melhor mês, contato mais distante, quantas entidades faltam para o DXCC).
  5. **Comparativo de períodos:** este ano × ano passado, este mês × média; o que cresceu, caiu e o que é
     novo.
  6. **Melhor horário por banda e região:** hora UTC × continente para cada banda, a partir dos próprios
     QSOs.
  7. **Alcance por banda ao longo do tempo:** distância e direção dos contatos por banda, mês a mês
     (efeito do ciclo solar).
  8. **Ficha do indicativo ampliada** (complementa o item do indicativo clicável): histórico com a
     estação, datas e quantidade de contatos.
  9. **Amigos frequentes e "sumidos":** estações mais contatadas e as que não aparecem há muito tempo.
  10. **Novos indicativos por período:** indicativos inéditos por mês.
  11. **Saúde do log:** QSOs sem quadrícula, banda incompatível com a frequência, modo inválido,
      possíveis duplicados com poucos minutos de diferença e indicativos possivelmente mal digitados
      (ex.: PT2VHF × PT2VFH), com correção em lote.
  12. **Conferência entre plataformas:** cruzar o log local com LoTW, QRZ e eQSL e listar o que está só
      de um lado, para reenviar.
  13. **Análise de concurso:** detectar o período pelo CONTEST_ID, pontuação estimada, multiplicadores,
      taxa por hora e comparação com o mesmo concurso do ano anterior.
  14. **Sincronização automática:** buscar novidades do QRZ/LoTW ao abrir o app, em segundo plano.
  15. **Painéis salvos:** guardar combinações de filtros com nome (ex.: "2 m FM em 2024").
  16. **Relatório anual pronto:** modelo de PDF "Meu ano no rádio" para compartilhar.
- **[Resolvido] Backlog (29/10/2026): unir "Enviar logs" e "Importar logs" num único "Importar logs".** Acabar com a
  fila intermediária herdada do QScope (que existe lá porque o arquivo sobe para um servidor): o usuário
  escolhe, arrasta ou cola os arquivos e a importação começa na hora, com o popup de progresso (importados,
  ignorados por já existirem, total) e o resumo final. Sem escolha de container (ver item de omitir
  containers); indicativo da estação padrão só quando o log não trouxer STATION_CALLSIGN. Renumerar o
  submenu Logs e atualizar ajuda e README.
- **[Resolvido] Backlog (29/10/2026): entidades clicáveis com ficha completa.** Assim como o indicativo, toda
  entidade exibida deve ser clicável e abrir tudo sobre ela nos meus contatos: países/entidades DXCC
  (ex.: matriz DXCC da aba QSL, DXCC first worked, DXCC/locator, mapas), quadrículas (grids), prefixos,
  zonas CQ/ITU, continentes e estações. A ficha mostra os QSOs, estações trabalhadas, bandas e modos,
  primeiro e último contato, status de QSL por banda (trabalhado/confirmado), quadrículas e mapa.
- **[Resolvido] Correção visual (29/10/2026):** na matriz DXCC da aba QSL, os títulos das colunas não ficam alinhados
  com os valores (DXCC e Continente deslocados); alinhar cabeçalho e células.
- **[Resolvido] Backlog (29/10/2026): análise de propagação a partir dos contatos.** Nova página (Estatísticas →
  Propagação) que usa os QSOs importados como evidência de abertura de propagação ao longo do tempo:
  - matriz mês × país/entidade (e mês × continente) por banda, mostrando quando cada região "abriu";
  - hora UTC × mês por banda e região (sazonalidade e janelas de abertura: greyline, abertura diurna/noturna);
  - distâncias e azimutes por banda ao longo dos meses (alcance médio/máximo e direções predominantes);
  - aberturas esporádicas em VHF/UHF (ex.: Es em 6 m e 2 m, tropo): QSOs longos fora do padrão da banda,
    agrupados por data, com mapa;
  - comparação entre anos (efeito do ciclo solar) e, opcionalmente, cruzamento com índices solares
    históricos (SFI/SSN, Kp) quando disponíveis;
  - tudo interativo (clique filtra, ficha da entidade) e exportável/relatório. Deixar claro que o resultado
    reflete a atividade do próprio operador (não mede propagação absoluta).
- **[Resolvido] Backlog (29/10/2026): ficha da estação com dados do QRZ.com (complementa o indicativo clicável).**
  Ao clicar num indicativo, a ficha mostra em cima os dados da estação e embaixo tudo o que fiz de contato
  com ela (QSOs, bandas, modos, primeiro/último contato, QSL por QSO, distância/azimute e mapa).
  - Fonte principal: API XML do QRZ.com (XML Logbook Data, `xmldata.qrz.com`), nunca leitura da página
    `qrz.com/db/<indicativo>` (proibida pelos termos do QRZ). Campos: foto, nome, QTH/endereço, país,
    quadrícula, coordenadas, zonas CQ/ITU, IOTA, classe de licença, uso de LoTW/eQSL e link "Ver no QRZ.com".
  - Assinatura XML Data do QRZ traz todos os campos (inclusive foto); conta gratuita traz só o básico (nome,
    cidade, país). Indicar na ficha quando o dado é limitado pelo tipo de conta.
  - Alternativa gratuita: HamQTH.com (API com cadastro): usar quando a conta QRZ não tiver assinatura ou a
    estação não estiver no QRZ. O que nenhuma fonte devolver vira link para abrir a página no navegador.
  - Credenciais do QRZ/HamQTH em Configurações, guardadas criptografadas (como as das plataformas).
  - Cache local no banco (dados e foto), com data da consulta e botão "Atualizar dados do QRZ", para não
    consultar a cada clique e funcionar offline.
- **[Resolvido] Ajuste de CI:** release existente nunca é sobrescrita; plataformas escolhidas em `.github/build-platforms.json`. o job de release usa `gh release upload --clobber`; um push
  na `main` sem mudar a versão sobrescreveria os pacotes da release já publicada no site (SHA-256 diferente).
  Pular o upload quando a release da versão já existir.

- **[Resolvido] Backlog (29/10/2026): páginas em sub-abas e filtros recolhidos.** Páginas longas são
  divididas automaticamente em sub-abas (por gráfico/seção) e a barra de filtros fica recolhida, mostrando
  só os chips dos filtros ativos, e expande quando necessário.
- **[Resolvido] Backlog (29/10/2026): screenshots na página do QSL Analyzer no site.**

## Próximos passos sugeridos

- HRDLog e Cloudlog/Wavelog via API (hoje: exportar ADIF e enviar).
- Atualização automática do CTY.DAT pela internet.
- Voltar a publicar Linux e macOS (adicionar em `.github/build-platforms.json`).
- Manual em PDF ilustrado, como nos outros aplicativos PT2VHF.
- Assinatura de código (Windows) e notarização Apple (macOS).

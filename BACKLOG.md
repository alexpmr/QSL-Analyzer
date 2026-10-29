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

- **Roadmap (29/10/2026): indicativo clicável em toda a aplicação.** Sempre que um indicativo aparecer
  (por exemplo, a lista de Estações trabalhadas, Busca no log, duplicados, pontos, DXCC first worked,
  QSOs mais distantes, dashboard), ele deve ser clicável e abrir tudo sobre aquela estação nos meus
  contatos: todos os QSOs (data/hora, banda, modo, RST, frequência, container, estação/operador),
  bandas e modos trabalhados, slots, primeiro e último contato, país/DXCC, zonas, quadrícula, distância
  e azimute, e status de QSL (papel, LoTW, eQSL) de cada QSO.
- **Ajuste de CI antes da próxima versão:** o job de release usa `gh release upload --clobber`; um push
  na `main` sem mudar a versão sobrescreveria os pacotes da release já publicada no site (SHA-256 diferente).
  Pular o upload quando a release da versão já existir.

## Próximos passos sugeridos

- HRDLog e Cloudlog/Wavelog via API (hoje: exportar ADIF e enviar).
- Atualização automática do CTY.DAT pela internet.
- Manual em PDF ilustrado, como nos outros aplicativos PT2VHF.
- Assinatura de código (Windows) e notarização Apple (macOS).

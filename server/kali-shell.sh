# Wormstar Kali-inspired color profile for Railway Debian/Bash sessions.
# Interactive Bash settings are persisted through the /home/tuser volume symlink.
case $- in *i*) ;; *) return 0 ;; esac
export HISTFILE="$HOME/.bash_history"
export HISTSIZE=100000 HISTFILESIZE=200000
export HISTCONTROL=ignoreboth:erasedups
shopt -s histappend
# Write history after each command rather than only on clean process exit.
if [ -n "${PROMPT_COMMAND:-}" ]; then
  PROMPT_COMMAND="history -a; $PROMPT_COMMAND"
else
  PROMPT_COMMAND='history -a'
fi
export PATH="$HOME/.venv/bin:$HOME/.npm-global/bin:$HOME/.local/bin:$HOME/go/bin:$HOME/.cargo/bin:$PATH"
export NPM_CONFIG_PREFIX="$HOME/.npm-global"
if [ -z "${NO_COLOR:-}" ] && [ -z "${WORMSTAR_NO_COLOR:-}" ]; then
  export CLICOLOR=1
  export COLORTERM=truecolor
  export LESS='-R'
  export GCC_COLORS='error=01;31:warning=01;33:note=01;36'
  export LS_COLORS='rs=0:di=01;38;5;75:ln=01;38;5;51:pi=38;5;220:so=38;5;45:bd=38;5;215:cd=38;5;215:or=01;38;5;196:mi=01;38;5;196:ex=01;38;5;84:*.py=38;5;84:*.js=38;5;221:*.jsx=38;5;221:*.ts=38;5;221:*.tsx=38;5;221:*.json=38;5;212:*.sh=01;38;5;81:*.md=38;5;215:*.zip=38;5;203:*.tar=38;5;203:*.gz=38;5;203:*.deb=38;5;215'
  alias ls='ls --color=auto'
  alias ll='ls -alF --color=auto'
  alias la='ls -A --color=auto'
  alias grep='grep --color=auto'
  # Readline non-printing delimiters keep cursor movement accurate.
  PS1='\[\e[1;38;2;73;174;230m\]┌──(\[\e[1;38;2;94;189;171m\]\u\[\e[1;38;2;73;174;230m\]@\h)─[\[\e[1;38;2;254;164;76m\]\w\[\e[1;38;2;73;174;230m\]]\[\e[0m\]\n\[\e[1;38;2;94;189;171m\]└─$\[\e[0m\] '
  export PS1
fi

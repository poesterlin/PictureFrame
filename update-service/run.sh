#!/bin/sh

git remote update

UPSTREAM=${1:-'@{u}'}
LOCAL=$(git rev-parse @)
REMOTE=$(git rev-parse "$UPSTREAM")
BASE=$(git merge-base @ "$UPSTREAM")

if [ $LOCAL = $REMOTE ]; then
    exit 0
elif [ $LOCAL = $BASE ]; then
    echo "Need to pull"
elif [ $REMOTE = $BASE ]; then
    echo "resetting"
    git clean -f -x
    git reset origin/master --hard
else
    echo "resetting"
    git clean -f -x
    git reset origin/master --hard
fi

git pull
cd e-inc/c
sudo make

cd ../..
npm install

pm2 start
pm2 save